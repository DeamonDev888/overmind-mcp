/**
 * ╔══════════════════════════════════════════════════════════════════════╗
 * ║   OVERMIND BRIDGE — OverBridgeServer (HTTP JSON-RPC 2.0 Entry Point)║
 * ║                                                                      ║
 * ║   Serveur HTTP qui expose l'API Overmind Bridge via JSON-RPC 2.0.    ║
 * ║   Permet à n'importe quel client (curl, Python, fetch...) de :       ║
 * ║     - Parler à un agent                                               ║
 * ║     - Faire parler des agents entre eux (A2A)                        ║
 * ║     - Suivre l'état live des agents (busy/idle/online)               ║
 * ║     - Consulter l'historique persistant des messages                 ║
 * ║                                                                      ║
 * ║   ARCHITECTURE                                                       ║
 * ║   ─────────────                                                      ║
 * ║   Client HTTP → POST /rpc → JSON-RPC dispatcher                      ║
 * ║                          → OverBridgeService (deja wrappe MCP)       ║
 * ║                          → AgentRegistry (etat live)                 ║
 * ║                          → MessageLog (persistence Postgres)         ║
 * ║                          → Overmind MCP :3099                        ║
 * ╚══════════════════════════════════════════════════════════════════════╝
 */

import http from 'node:http';
import { URL } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';
import { z } from 'zod';
import { OverBridgeService } from './OverBridgeService.js';
import { AgentRegistry, type AgentLiveState } from './AgentRegistry.js';
import { MessageLog, type MessageLogConfig } from './MessageLog.js';
import { SessionStore, type SessionEntry, type SessionContextPatch } from './SessionStore.js';
import { DirectiveParser, type ParsedDirectives } from './DirectiveParser.js';
import { WebhookAdapter, type WebhookProvider, type NormalizedWebhook } from './WebhookAdapter.js';
import { sanitizeAndParse, sanitizeJsonRaw, looksLikeWindowsPathIssue } from './JsonSanitizer.js';
import { getOrCreateRequestId, newRequestId } from './RequestContext.js';
import { createBridgeLogger, type BridgeLogger, validateAgentName } from './utils.js';
import type { RunnerType } from './types.js';

// ─── JSON-RPC 2.0 Types ────────────────────────────────────────────────────

export interface JsonRpcRequest {
  jsonrpc: '2.0';
  id?: number | string | null;
  method: string;
  params?: Record<string, unknown>;
}

export interface JsonRpcResponse {
  jsonrpc: '2.0';
  id: number | string | null;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
}

const JSON_RPC_ERRORS = {
  PARSE_ERROR: { code: -32700, message: 'Parse error' },
  INVALID_REQUEST: { code: -32600, message: 'Invalid Request' },
  METHOD_NOT_FOUND: { code: -32601, message: 'Method not found' },
  INVALID_PARAMS: { code: -32602, message: 'Invalid params' },
  INTERNAL_ERROR: { code: -32603, message: 'Internal error' },
  AGENT_BUSY: { code: -32001, message: 'Agent is busy' },
  AGENT_OFFLINE: { code: -32002, message: 'Agent is offline' },
} as const;

// ─── Zod Schemas (validation des params par méthode) ─────────────────────

const RunAgentParams = z.object({
  agentName: z.string().min(1),
  runner: z.string().min(1),
  prompt: z.string().min(1),
  sessionId: z.string().optional(),
  path: z.string().optional(),
  model: z.string().optional(),
  mode: z.string().optional(),
  silent: z.boolean().optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
  /** Clé externe pour SessionStore (phone, userId, etc.) — auto-résolution de sessionId */
  externalKey: z.string().optional(),
  /** Active le parsing de directives dans la réponse (default: true si enableDirectives) */
  parseDirectives: z.boolean().optional(),
});

const A2AParams = z.object({
  fromAgent: z.string().min(1),
  toAgent: z.string().min(1),
  runner: z.string().min(1),
  prompt: z.string().min(1),
  model: z.string().optional(),
  path: z.string().optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

const AgentStatusParams = z.object({
  agentName: z.string().min(1),
  runner: z.string().optional(),
  action: z.enum(['status', 'stream', 'kill', 'wait']).default('status'),
  sinceTimestamp: z.number().optional(),
  timeoutMs: z.number().optional(),
});

const ListAgentsParams = z.object({
  status: z.enum(['online', 'offline', 'busy', 'idle']).optional(),
  runner: z.string().optional(),
}).default({});

const MessageHistoryParams = z.object({
  toAgent: z.string().optional(),
  fromAgent: z.string().nullable().optional(),
  status: z.enum(['pending', 'running', 'done', 'failed', 'timeout']).optional(),
  limit: z.number().int().min(1).max(500).default(50),
  offset: z.number().int().min(0).default(0),
  sinceHours: z.number().positive().optional(),
});
const MessageGetParams = z.object({
  id: z.string().uuid(),
});

const MessageReplayParams = z.object({
  id: z.string().uuid(),
});

// ─── Server Config ────────────────────────────────────────────────────────

export interface OverBridgeServerConfig {
  /** Port d'écoute HTTP (default: 3100) */
  port: number;
  /** Host d'écoute (default: '127.0.0.1') */
  host: string;
  /** Config Postgres pour MessageLog */
  postgres: MessageLogConfig;
  /** Active le MessageLog (si false, les messages ne sont pas persistés) */
  enableMessageLog: boolean;
  /** Authentification simple par token (Authorization: Bearer *** — optionnel */
  authToken?: string;
  /** Health check interval pour OverBridgeService (default: 30000ms) */
  healthCheckIntervalMs: number;
  /** Active le SessionStore multi-tenant (sessions par clé externe) */
  enableSessionStore?: boolean;
  /** Chemin du fichier de persistence des sessions (default: ~/.overmind/bridge/sessions.json) */
  sessionStorePath?: string;
  /** TTL des sessions en ms (default: 4h) */
  sessionTtlMs?: number;
  /** Active le parsing de directives dans les réponses agent (SESSION_ID, CONTEXT_UPDATE, BRIDGE_NEXT) */
  enableDirectives?: boolean;
  /** Active le support webhook (auto-mount /webhook/:provider endpoints) */
  enableWebhooks?: boolean;
  /** JSON body limit (default: '10mb') */
  jsonBodyLimit?: string;
  /** Active la sanitization JSON (Windows paths) */
  sanitizeJson?: boolean;
}

// ─── OverBridgeServer ─────────────────────────────────────────────────────

export class OverBridgeServer {
  private readonly service: OverBridgeService;
  private readonly registry: AgentRegistry;
  private readonly log: BridgeLogger;
  private readonly messageLog: MessageLog | undefined;
  private readonly sessions: SessionStore | undefined;
  private readonly directiveParser: DirectiveParser;
  private readonly webhookAdapter: WebhookAdapter;
  private readonly config: OverBridgeServerConfig;
  private server: http.Server | undefined;
  private startTime = 0;

  constructor(
    service: OverBridgeService,
    config: OverBridgeServerConfig,
    logger?: BridgeLogger,
  ) {
    this.service = service;
    this.config = config;
    this.log = logger ?? createBridgeLogger('overbridge-server');
    this.registry = new AgentRegistry(this.log);
    this.directiveParser = new DirectiveParser({ logger: this.log });
    this.webhookAdapter = new WebhookAdapter({ logger: this.log });
    if (config.enableMessageLog) {
      this.messageLog = new MessageLog(config.postgres, this.log);
    }
    if (config.enableSessionStore) {
      const defaultPath = path.join(
        process.env.HOME ?? process.env.USERPROFILE ?? '.',
        '.overmind',
        'bridge',
        'sessions.json',
      );
      this.sessions = new SessionStore(
        {
          persistPath: config.sessionStorePath ?? defaultPath,
          ttlMs: config.sessionTtlMs,
        },
        this.log,
      );
    }
  }

  // ─── Lifecycle ───────────────────────────────────────────────────────────

  /**
   * Démarre le serveur HTTP et initialise les dépendances (MessageLog, SessionStore, OverBridgeService).
   */
  async start(): Promise<{ port: number; host: string; url: string }> {
    this.startTime = Date.now();

    // 1) Init MessageLog (Postgres)
    if (this.messageLog) {
      await this.messageLog.init();
    }

    // 2) Init SessionStore
    if (this.sessions) {
      await this.sessions.init();
    }

    // 3) Connect OverBridgeService (MCP healthcheck)
    try {
      const status = await this.service.connect(this.config.healthCheckIntervalMs);
      this.log.info(`🔌 OverBridgeService connected: ${status.status}`);
    } catch (err) {
      this.log.warn(`⚠️  OverBridgeService connect failed: ${(err as Error).message}`);
      // On continue quand même, le serveur répondra avec erreurs si MCP down
    }

    // 4) Démarre le serveur HTTP
    this.server = http.createServer((req, res) => this.handleRequest(req, res));
    await new Promise<void>((resolve) => {
      this.server!.listen(this.config.port, this.config.host, () => resolve());
    });

    const addr = this.server.address();
    const port = typeof addr === 'object' && addr ? addr.port : this.config.port;
    const url = `http://${this.config.host}:${port}`;

    this.log.info(`🚀 OverBridgeServer listening on ${url}`);
    this.log.info(`   POST ${url}/rpc   (JSON-RPC 2.0)`);
    this.log.info(`   GET  ${url}/health`);
    if (this.config.enableWebhooks) {
      this.log.info(`   POST ${url}/webhook/:provider   (voipms, twilio, discord, generic)`);
    }
    if (this.sessions) {
      this.log.info(`   SessionStore: enabled (TTL ${(this.config.sessionTtlMs ?? 14_400_000) / 1000}s)`);
    }
    if (this.config.enableDirectives) {
      this.log.info(`   DirectiveParser: enabled (SESSION_ID, CONTEXT_UPDATE, BRIDGE_NEXT)`);
    }

    return { port, host: this.config.host, url };
  }

  /**
   * Ferme proprement le serveur HTTP et les dépendances.
   */
  async stop(): Promise<void> {
    if (this.server) {
      await new Promise<void>((resolve) => this.server!.close(() => resolve()));
      this.server = undefined;
      this.log.info('🛑 HTTP server closed');
    }
    this.service.disconnect();
    if (this.messageLog) {
      await this.messageLog.close();
    }
    if (this.sessions) {
      await this.sessions.close();
    }
  }

  /**
   * Expose le registry (pour tests / inspection).
   */
  get agentRegistry(): AgentRegistry {
    return this.registry;
  }

  /**
   * Expose le MessageLog (pour tests / inspection).
   */
  get messages(): MessageLog | undefined {
    return this.messageLog;
  }

  /**
   * Expose le SessionStore (pour tests / inspection).
   */
  get sessionStore(): SessionStore | undefined {
    return this.sessions;
  }

  // ─── HTTP Request Handler ───────────────────────────────────────────────

  private async handleRequest(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
    const reqId = getOrCreateRequestId(req.headers as Record<string, string | string[] | undefined>);

    // Set reqId header in response
    res.setHeader('X-Request-Id', reqId);

    // CORS preflight
    if (req.method === 'OPTIONS') {
      this.writeCors(res);
      res.writeHead(204);
      res.end();
      return;
    }

    this.writeCors(res);

    try {
      // Health check simple
      if (req.method === 'GET' && url.pathname === '/health') {
        await this.handleHealth(res);
        return;
      }

      // JSON-RPC endpoint
      if (req.method === 'POST' && url.pathname === '/rpc') {
        await this.handleRpc(req, res, reqId);
        return;
      }

      // Webhook endpoint (si activé) — /webhook/:provider
      if (this.config.enableWebhooks && req.method === 'POST' && url.pathname.startsWith('/webhook/')) {
        await this.handleWebhook(req, res, url, reqId);
        return;
      }

      // File serve — /f/:filename (statique, comme bt-sms)
      if (req.method === 'GET' && url.pathname.startsWith('/f/')) {
        await this.handleStaticFile(req, res, url);
        return;
      }

      // 404
      this.writeJson(res, 404, { error: 'Not found', path: url.pathname, reqId });
    } catch (err) {
      this.log.error(`💥 Unhandled error: ${(err as Error).message} (reqId=${reqId})`);
      this.writeJson(res, 500, { error: 'Internal server error', reqId });
    }
  }

  private writeCors(res: http.ServerResponse): void {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  }

  private writeJson(res: http.ServerResponse, status: number, body: unknown): void {
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(body));
  }

  // ─── /webhook/:provider Endpoint ─────────────────────────────────────────

  private async handleWebhook(
    req: http.IncomingMessage,
    res: http.ServerResponse,
    url: URL,
    reqId: string,
  ): Promise<void> {
    // /webhook/:provider — extrait le provider du path
    const parts = url.pathname.split('/').filter(Boolean);
    const provider = (parts[1] ?? 'voipms') as WebhookProvider;

    const raw = await this.readBody(req);
    let payload: Record<string, unknown>;
    try {
      payload = JSON.parse(raw) as Record<string, unknown>;
    } catch {
      // Tente sanitizer (VoIP.ms envoie parfois du form-encoded mal formé)
      try {
        payload = sanitizeAndParse(raw) as Record<string, unknown>;
      } catch {
        this.writeJson(res, 400, { error: 'Invalid JSON body', reqId });
        return;
      }
    }

    // Adapte via WebhookAdapter
    const adapter = new WebhookAdapter({ provider, logger: this.log });
    let normalized: NormalizedWebhook;
    try {
      normalized = adapter.adapt(payload);
    } catch (err) {
      this.writeJson(res, 400, { error: (err as Error).message, reqId });
      return;
    }

    // Auto-dispatch vers agent.run via internal call
    this.log.info(`[reqId=${reqId}] 📨 Webhook ${provider} from ${normalized.externalKey}`);

    // Cherche un agent par défaut (config-driven ou fallback premier agent)
    // Pour l'instant on retourne le normalized et on log ; les utilisateurs
    // peuvent soit :
    //   1. Définir une config par-provider pour auto-dispatch
    //   2. Appeler manuellement /rpc agent.run après réception
    this.writeJson(res, 200, {
      received: true,
      reqId,
      provider,
      externalKey: normalized.externalKey,
      promptPreview: normalized.prompt.slice(0, 200),
      mediaCount: normalized.mediaUrls.length,
      metadata: normalized.metadata,
    });
  }

  // ─── /f/:filename Static File Serve ──────────────────────────────────────

  private async handleStaticFile(
    _req: http.IncomingMessage,
    res: http.ServerResponse,
    url: URL,
  ): Promise<void> {
    const filename = url.pathname.slice(3); // strip /f/
    if (!filename || filename.includes('..')) {
      this.writeJson(res, 400, { error: 'Invalid filename' });
      return;
    }
    // Le dossier est configuré via BRIDGE_STATIC_DIR env ou défaut './public'
    const staticDir = process.env.BRIDGE_STATIC_DIR ?? './public';
    const filepath = path.join(staticDir, filename);
    if (!fs.existsSync(filepath)) {
      this.writeJson(res, 404, { error: 'Not found' });
      return;
    }
    const ext = path.extname(filepath).toLowerCase();
    const mimeMap: Record<string, string> = {
      '.html': 'text/html', '.pdf': 'application/pdf', '.png': 'image/png',
      '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.json': 'application/json',
      '.txt': 'text/plain', '.mp3': 'audio/mpeg', '.mp4': 'video/mp4',
      '.gif': 'image/gif', '.wav': 'audio/wav', '.xml': 'text/xml',
    };
    res.setHeader('Content-Type', mimeMap[ext] ?? 'application/octet-stream');
    fs.createReadStream(filepath).pipe(res);
  }

  // ─── /health Endpoint ───────────────────────────────────────────────────

  private async handleHealth(res: http.ServerResponse): Promise<void> {
    const mcpHealth = await this.service.proxyAccess.healthCheck();
    const regStats = this.registry.stats();
    let msgStats: Awaited<ReturnType<MessageLog['stats']>> | null = null;
    if (this.messageLog) {
      try {
        msgStats = await this.messageLog.stats();
      } catch {
        msgStats = null;
      }
    }
    const sessionStats = this.sessions ? this.sessions.stats() : null;

    this.writeJson(res, 200, {
      status: mcpHealth.status,
      uptime: Date.now() - this.startTime,
      mcp: mcpHealth,
      agents: regStats,
      messages: msgStats,
      sessions: sessionStats,
      features: {
        sessionStore: !!this.sessions,
        directives: !!this.config.enableDirectives,
        webhooks: !!this.config.enableWebhooks,
        sanitizeJson: !!this.config.sanitizeJson,
        messageLog: !!this.messageLog,
      },
      version: '1.1.0',
    });
  }

  // ─── /rpc Endpoint (JSON-RPC 2.0 Dispatcher) ────────────────────────────

  private async handleRpc(req: http.IncomingMessage, res: http.ServerResponse, reqId: string): Promise<void> {
    // Auth check
    if (this.config.authToken) {
      const auth = req.headers.authorization;
      if (auth !== `Bearer ${this.config.authToken}`) {
        this.writeJson(res, 401, {
          jsonrpc: '2.0',
          id: null,
          error: { code: -32000, message: 'Unauthorized', data: { reqId } },
        });
        return;
      }
    }

    // Body parsing
    const raw = await this.readBody(req);
    let parsed: JsonRpcRequest | JsonRpcRequest[];
    try {
      // Try direct parse first
      parsed = JSON.parse(raw) as JsonRpcRequest | JsonRpcRequest[];
    } catch {
      // Si sanitizer activé et body ressemble à un Windows path, on tente la repair
      if (this.config.sanitizeJson && looksLikeWindowsPathIssue(raw)) {
        try {
          parsed = sanitizeAndParse(raw) as JsonRpcRequest | JsonRpcRequest[];
          this.log.warn(`[reqId=${reqId}] ⚠️  JSON body sanitized (Windows path issue)`);
        } catch {
          this.respondError(res, null, JSON_RPC_ERRORS.PARSE_ERROR);
          return;
        }
      } else {
        this.respondError(res, null, JSON_RPC_ERRORS.PARSE_ERROR);
        return;
      }
    }

    // Inject reqId into all calls (pour corrélation)
    const injectReqId = (reqs: JsonRpcRequest | JsonRpcRequest[]): void => {
      const inject = (r: JsonRpcRequest) => {
        if (!r.params) r.params = {};
        (r.params as Record<string, unknown>).__reqId = reqId;
      };
      if (Array.isArray(reqs)) reqs.forEach(inject);
      else inject(reqs);
    };
    injectReqId(parsed);

    // Batch ou single
    if (Array.isArray(parsed)) {
      if (parsed.length === 0) {
        this.respondError(res, null, JSON_RPC_ERRORS.INVALID_REQUEST);
        return;
      }
      const responses = await Promise.all(
        parsed.map((r) => this.dispatchRpc(r).catch((e) => this.buildErrorResponse(r.id ?? null, e))),
      );
      this.writeJson(res, 200, responses);
    } else {
      const response = await this.dispatchRpc(parsed);
      this.writeJson(res, 200, response);
    }
  }

  /**
   * Dispatch une requête JSON-RPC vers la bonne méthode.
   */
  private async dispatchRpc(req: JsonRpcRequest): Promise<JsonRpcResponse> {
    // Validation de base JSON-RPC 2.0
    if (req.jsonrpc !== '2.0' || !req.method) {
      return { jsonrpc: '2.0', id: req.id ?? null, error: JSON_RPC_ERRORS.INVALID_REQUEST };
    }

    try {
      switch (req.method) {
        case 'agent.run':
          return this.methodAgentRun(req);
        case 'agent.a2a':
          return this.methodAgentA2A(req);
        case 'agent.status':
          return this.methodAgentStatus(req);
        case 'agent.list':
          return this.methodAgentList(req);
        case 'agent.kill':
          return this.methodAgentKill(req);
        case 'message.history':
          return this.methodMessageHistory(req);
        case 'message.get':
          return this.methodMessageGet(req);
        case 'message.replay':
          return this.methodMessageReplay(req);
        case 'message.stats':
          return this.methodMessageStats(req);
        case 'session.get':
          return this.methodSessionGet(req);
        case 'session.list':
          return this.methodSessionList(req);
        case 'session.delete':
          return this.methodSessionDelete(req);
        case 'session.stats':
          return this.methodSessionStats(req);
        case 'webhook.sms':
          return this.methodWebhookSms(req);
        case 'health.ping':
          return { jsonrpc: '2.0', id: req.id ?? null, result: { pong: true, ts: Date.now() } };
        default:
          return {
            jsonrpc: '2.0',
            id: req.id ?? null,
            error: { ...JSON_RPC_ERRORS.METHOD_NOT_FOUND, data: { method: req.method } },
          };
      }
    } catch (err) {
      this.log.error(`💥 ${req.method} failed: ${(err as Error).message}`);
      return this.buildErrorResponse(req.id ?? null, err);
    }
  }

  // ─── RPC Methods ─────────────────────────────────────────────────────────

  /**
   * agent.run — Lance un agent (from client externe OU from autre agent).
   * Avec support SessionStore (externalKey) et DirectiveParser.
   */
  private async methodAgentRun(req: JsonRpcRequest): Promise<JsonRpcResponse> {
    const params = this.validateParams(RunAgentParams, req.params, req.id);
    if (!params.ok) return params.response;

    const { agentName, runner, prompt, sessionId, path, model, mode, silent, metadata, externalKey, parseDirectives } = params.data;
    const validatedAgentName = validateAgentName(agentName);
    const reqId = (req.params as { __reqId?: string } | undefined)?.__reqId;

    // Register
    this.registry.register(validatedAgentName, runner as RunnerType);

    // SessionStore resolution (si externalKey fourni)
    let effectiveSessionId = sessionId;
    if (this.sessions && externalKey) {
      const stored = this.sessions.get(externalKey, validatedAgentName);
      if (stored) {
        effectiveSessionId = stored.sessionId;
        this.log.info(`[reqId=${reqId}] 🔗 Session restored for ${externalKey} → ${effectiveSessionId}`);
      }
    }

    // Persist (pending)
    let messageId: string | undefined;
    if (this.messageLog) {
      messageId = await this.messageLog.create({
        fromAgent: (metadata?.fromAgent as string) ?? null,
        toAgent: validatedAgentName,
        runner: runner as RunnerType,
        prompt,
        sessionId: effectiveSessionId,
        metadata: { ...(metadata ?? {}), ...(reqId ? { reqId } : {}), ...(externalKey ? { externalKey } : {}) },
      });
    }

    // Run avec mutex (1 run par agent à la fois)
    const result = await this.registry.withLock(validatedAgentName, async () => {
      this.registry.markBusy(validatedAgentName, effectiveSessionId);
      if (messageId && this.messageLog) {
        await this.messageLog.markRunning(messageId, effectiveSessionId);
      }

      try {
        const agentResult = await this.service.runAgent({
          runner: runner as RunnerType,
          prompt,
          agentName: validatedAgentName,
          sessionId: effectiveSessionId,
          path,
          model,
          mode,
          silent,
        });

        const rawResponseText = agentResult.content.map((c) => c.text).join('\n');

        // ─── Directive parsing ─────────────────────────────────────────
        let cleanText = rawResponseText;
        let directives: ParsedDirectives | undefined;
        const shouldParseDirectives = parseDirectives ?? this.config.enableDirectives;
        if (shouldParseDirectives) {
          directives = this.directiveParser.parse(rawResponseText);
          cleanText = directives.cleanText;

          for (const action of directives.actions) {
            if (action.kind === 'session' && this.sessions && externalKey) {
              this.sessions.updateSessionId(
                externalKey,
                validatedAgentName,
                action.sessionId,
                runner as string,
              );
              this.log.info(`[reqId=${reqId}] 🔗 SESSION_ID directive → ${action.sessionId}`);
            } else if (action.kind === 'context' && this.sessions && externalKey) {
              this.sessions.updateContext(externalKey, validatedAgentName, action.patch);
              this.log.info(`[reqId=${reqId}] 📝 CONTEXT_UPDATE directive → ${JSON.stringify(action.patch)}`);
            } else if (action.kind === 'hint') {
              this.log.info(`[reqId=${reqId}] 💡 BRIDGE_HINT: ${action.text}`);
            }
          }
        }

        // Save session
        if (this.sessions && externalKey && agentResult.sessionId) {
          this.sessions.set({
            externalKey,
            agentName: validatedAgentName,
            runner: runner as string,
            sessionId: agentResult.sessionId,
            context: directives?.actions.find((a) => a.kind === 'context')
              ? (directives.actions.find((a) => a.kind === 'context') as { patch: Record<string, string> }).patch
              : undefined,
          });
        }

        if (messageId && this.messageLog) {
          await this.messageLog.markDone(messageId, cleanText, agentResult.sessionId);
        }
        this.registry.markIdle(validatedAgentName, !agentResult.isError);
        if (!agentResult.isError) this.registry.markOnline(validatedAgentName);

        // Return content nettoyé des directives (si parsing activé)
        const resultContent = shouldParseDirectives
          ? [{ type: 'text', text: cleanText }]
          : agentResult.content;

        return {
          messageId,
          sessionId: agentResult.sessionId,
          content: resultContent,
          isError: agentResult.isError,
          directives: shouldParseDirectives
            ? directives?.actions.map((a) => a.kind)
            : undefined,
        };
      } catch (err) {
        const errorMsg = (err as Error).message;
        if (messageId && this.messageLog) {
          if (errorMsg.includes('TIMEOUT') || errorMsg.includes('timeout')) {
            await this.messageLog.markTimeout(messageId);
          } else {
            await this.messageLog.markFailed(messageId, errorMsg);
          }
        }
        this.registry.markIdle(validatedAgentName, false);
        throw err;
      }
    });

    return { jsonrpc: '2.0', id: req.id ?? null, result };
  }

  /**
   * agent.a2a — Agent A parle à Agent B (le hub orchestre).
   * B reçoit un prompt enrichi avec le contexte de A.
   */
  private async methodAgentA2A(req: JsonRpcRequest): Promise<JsonRpcResponse> {
    const params = this.validateParams(A2AParams, req.params, req.id);
    if (!params.ok) return params.response;

    const { fromAgent, toAgent, runner, prompt, model, path, metadata } = params.data;
    const validatedFrom = validateAgentName(fromAgent);
    const validatedTo = validateAgentName(toAgent);

    // Register les deux si pas vus
    this.registry.register(validatedFrom, runner as RunnerType);
    this.registry.register(validatedTo, runner as RunnerType);
    this.registry.incrementA2aSent(validatedFrom);
    this.registry.incrementA2aReceived(validatedTo);

    // Enrichit le prompt avec contexte A→B
    const enrichedPrompt = [
      `[A2A — Agent-to-Agent Message]`,
      `FROM: ${validatedFrom}`,
      `TO: ${validatedTo}`,
      `TIMESTAMP: ${new Date().toISOString()}`,
      `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`,
      prompt,
    ].join('\n');

    // Persist + run (délègue à agent.run)
    let messageId: string | undefined;
    if (this.messageLog) {
      messageId = await this.messageLog.create({
        fromAgent: validatedFrom,
        toAgent: validatedTo,
        runner: runner as RunnerType,
        prompt: enrichedPrompt,
        metadata: { ...(metadata ?? {}), a2a: true, from: validatedFrom, to: validatedTo },
      });
    }

    const result = await this.registry.withLock(validatedTo, async () => {
      this.registry.markBusy(validatedTo);
      if (messageId && this.messageLog) {
        await this.messageLog.markRunning(messageId);
      }

      try {
        const agentResult = await this.service.runAgent({
          runner: runner as RunnerType,
          prompt: enrichedPrompt,
          agentName: validatedTo,
          path,
          model,
        });

        const responseText = agentResult.content.map((c) => c.text).join('\n');
        if (messageId && this.messageLog) {
          await this.messageLog.markDone(messageId, responseText, agentResult.sessionId);
        }
        this.registry.markIdle(validatedTo, !agentResult.isError);
        if (!agentResult.isError) this.registry.markOnline(validatedTo);

        return {
          messageId,
          from: validatedFrom,
          to: validatedTo,
          sessionId: agentResult.sessionId,
          content: agentResult.content,
          isError: agentResult.isError,
        };
      } catch (err) {
        const errorMsg = (err as Error).message;
        if (messageId && this.messageLog) {
          if (errorMsg.includes('TIMEOUT') || errorMsg.includes('timeout')) {
            await this.messageLog.markTimeout(messageId);
          } else {
            await this.messageLog.markFailed(messageId, errorMsg);
          }
        }
        this.registry.markIdle(validatedTo, false);
        throw err;
      }
    });

    return { jsonrpc: '2.0', id: req.id ?? null, result };
  }

  /**
   * agent.status — Status live d'un agent (busy/idle/online) via registry.
   * Possibilité de proxy vers Overmind MCP agent_control aussi.
   */
  private async methodAgentStatus(req: JsonRpcRequest): Promise<JsonRpcResponse> {
    const params = this.validateParams(AgentStatusParams, req.params, req.id);
    if (!params.ok) return params.response;

    const { agentName, runner, action, sinceTimestamp, timeoutMs } = params.data;
    const validatedName = validateAgentName(agentName);

    // Status local du registry (instantané)
    const localState = this.registry.get(validatedName);

    // Si action demandée (status/stream/kill/wait), on proxy vers MCP
    if (action) {
      const result = await this.service.agentStatus({
        agentName: validatedName,
        action,
        runner: runner as RunnerType | undefined,
        sinceTimestamp,
        timeoutMs,
      });

      // Sync registry avec retour MCP
      if (action === 'status') {
        const mcpState = this.parseAgentControlStatus(result);
        if (mcpState === 'running') {
          this.registry.markBusy(validatedName, result.sessionId);
        } else if (mcpState === 'done') {
          this.registry.markIdle(validatedName, true);
          this.registry.markOnline(validatedName);
        } else if (mcpState === 'failed') {
          this.registry.markIdle(validatedName, false);
        } else if (mcpState === 'orphaned') {
          this.registry.markOffline(validatedName);
        }
      } else if (action === 'kill') {
        this.registry.markOffline(validatedName);
      }

      return {
        jsonrpc: '2.0',
        id: req.id ?? null,
        result: { local: localState, mcp: result },
      };
    }

    return { jsonrpc: '2.0', id: req.id ?? null, result: { local: localState } };
  }

  /**
   * agent.list — Liste tous les agents et leur état.
   */
  private async methodAgentList(req: JsonRpcRequest): Promise<JsonRpcResponse> {
    const params = this.validateParams(ListAgentsParams, req.params, req.id);
    if (!params.ok) return params.response;

    const agents = this.registry.list({
      status: params.data.status as AgentLiveState['status'] | undefined,
      runner: params.data.runner as RunnerType | undefined,
    });
    const stats = this.registry.stats();

    return { jsonrpc: '2.0', id: req.id ?? null, result: { agents, stats } };
  }

  /**
   * agent.kill — Kill un agent en cours.
   */
  private async methodAgentKill(req: JsonRpcRequest): Promise<JsonRpcResponse> {
    const params = this.validateParams(
      z.object({ agentName: z.string().min(1), runner: z.string().optional() }),
      req.params,
      req.id,
    );
    if (!params.ok) return params.response;

    const result = await this.service.killAgent(
      validateAgentName(params.data.agentName),
      params.data.runner as RunnerType | undefined,
    );
    this.registry.markOffline(params.data.agentName);

    return { jsonrpc: '2.0', id: req.id ?? null, result };
  }

  /**
   * message.history — Historique des messages persistés.
   */
  private async methodMessageHistory(req: JsonRpcRequest): Promise<JsonRpcResponse> {
    if (!this.messageLog) {
      return { jsonrpc: '2.0', id: req.id ?? null, error: { code: -32003, message: 'MessageLog disabled' } };
    }
    const params = this.validateParams(MessageHistoryParams, req.params, req.id);
    if (!params.ok) return params.response;

    const messages = await this.messageLog.list(params.data);
    return { jsonrpc: '2.0', id: req.id ?? null, result: { messages, count: messages.length } };
  }

  /**
   * message.get — Récupère un message par ID.
   */
  private async methodMessageGet(req: JsonRpcRequest): Promise<JsonRpcResponse> {
    if (!this.messageLog) {
      return { jsonrpc: '2.0', id: req.id ?? null, error: { code: -32003, message: 'MessageLog disabled' } };
    }
    const params = this.validateParams(MessageGetParams, req.params, req.id);
    if (!params.ok) return params.response;

    const message = await this.messageLog.getById(params.data.id);
    return { jsonrpc: '2.0', id: req.id ?? null, result: { message } };
  }

  /**
   * message.replay — Rejoue un message (re-run l'agent avec le même prompt).
   * Le nouveau run crée un NOUVEAU message, l'ancien reste en status 'pending' pour traçabilité.
   */
  private async methodMessageReplay(req: JsonRpcRequest): Promise<JsonRpcResponse> {
    if (!this.messageLog) {
      return { jsonrpc: '2.0', id: req.id ?? null, error: { code: -32003, message: 'MessageLog disabled' } };
    }
    const params = this.validateParams(MessageReplayParams, req.params, req.id);
    if (!params.ok) return params.response;

    const original = await this.messageLog.getById(params.data.id);
    if (!original) {
      return { jsonrpc: '2.0', id: req.id ?? null, error: { code: -32004, message: 'Message not found' } };
    }

    // Relance via agent.run
    const replayReq: JsonRpcRequest = {
      jsonrpc: '2.0',
      id: req.id,
      method: 'agent.run',
      params: {
        agentName: original.toAgent,
        runner: original.runner,
        prompt: original.prompt,
        sessionId: original.sessionId ?? undefined,
        metadata: { ...(original.metadata ?? {}), replayOf: original.id },
      },
    };
    return this.methodAgentRun(replayReq);
  }

  /**
   * message.stats — Statistiques globales du log.
   */
  private async methodMessageStats(req: JsonRpcRequest): Promise<JsonRpcResponse> {
    if (!this.messageLog) {
      return { jsonrpc: '2.0', id: req.id ?? null, error: { code: -32003, message: 'MessageLog disabled' } };
    }
    const stats = await this.messageLog.stats();
    return { jsonrpc: '2.0', id: req.id ?? null, result: stats };
  }

  // ─── SessionStore RPC Methods ───────────────────────────────────────────

  private async methodSessionGet(req: JsonRpcRequest): Promise<JsonRpcResponse> {
    if (!this.sessions) {
      return { jsonrpc: '2.0', id: req.id ?? null, error: { code: -32003, message: 'SessionStore disabled' } };
    }
    const params = this.validateParams(
      z.object({ externalKey: z.string().min(1), agentName: z.string().min(1) }),
      req.params,
      req.id,
    );
    if (!params.ok) return params.response;

    const entry = this.sessions.get(params.data.externalKey, params.data.agentName);
    return { jsonrpc: '2.0', id: req.id ?? null, result: { session: entry } };
  }

  private async methodSessionList(_req: JsonRpcRequest): Promise<JsonRpcResponse> {
    if (!this.sessions) {
      return { jsonrpc: '2.0', id: _req.id ?? null, error: { code: -32003, message: 'SessionStore disabled' } };
    }
    const list = this.sessions.list();
    const stats = this.sessions.stats();
    return { jsonrpc: '2.0', id: _req.id ?? null, result: { sessions: list, stats } };
  }

  private async methodSessionDelete(req: JsonRpcRequest): Promise<JsonRpcResponse> {
    if (!this.sessions) {
      return { jsonrpc: '2.0', id: req.id ?? null, error: { code: -32003, message: 'SessionStore disabled' } };
    }
    const params = this.validateParams(
      z.object({ externalKey: z.string().min(1), agentName: z.string().min(1) }),
      req.params,
      req.id,
    );
    if (!params.ok) return params.response;

    const deleted = this.sessions.delete(params.data.externalKey, params.data.agentName);
    return { jsonrpc: '2.0', id: req.id ?? null, result: { deleted } };
  }

  private async methodSessionStats(_req: JsonRpcRequest): Promise<JsonRpcResponse> {
    if (!this.sessions) {
      return { jsonrpc: '2.0', id: _req.id ?? null, error: { code: -32003, message: 'SessionStore disabled' } };
    }
    return { jsonrpc: '2.0', id: _req.id ?? null, result: this.sessions.stats() };
  }

  // ─── Webhook RPC Method (programmatic, sans passer par HTTP) ────────────

  private async methodWebhookSms(req: JsonRpcRequest): Promise<JsonRpcResponse> {
    const params = this.validateParams(
      z.object({
        provider: z.enum(['voipms', 'twilio', 'discord', 'generic']).default('voipms'),
        payload: z.record(z.string(), z.unknown()),
        externalKey: z.string().optional(),
        /** Si fourni, dispatch automatique vers agent.run après adaptation */
        autoDispatch: z.object({
          agentName: z.string().min(1),
          runner: z.string().min(1),
          model: z.string().optional(),
          mode: z.string().optional(),
        }).optional(),
      }),
      req.params,
      req.id,
    );
    if (!params.ok) return params.response;

    const adapter = new WebhookAdapter({ provider: params.data.provider, logger: this.log });
    const normalized = adapter.adapt(params.data.payload);
    const externalKey = params.data.externalKey ?? normalized.externalKey;

    if (!params.data.autoDispatch) {
      return {
        jsonrpc: '2.0',
        id: req.id ?? null,
        result: { externalKey, prompt: normalized.prompt, mediaUrls: normalized.mediaUrls, metadata: normalized.metadata },
      };
    }

    // Auto-dispatch vers agent.run
    const innerReq: JsonRpcRequest = {
      jsonrpc: '2.0',
      id: req.id,
      method: 'agent.run',
      params: {
        agentName: params.data.autoDispatch.agentName,
        runner: params.data.autoDispatch.runner,
        prompt: normalized.prompt,
        model: params.data.autoDispatch.model,
        mode: params.data.autoDispatch.mode,
        externalKey,
        metadata: { webhook: true, provider: params.data.provider, ...normalized.metadata },
      },
    };
    return this.methodAgentRun(innerReq);
  }

  // ─── Helpers ────────────────────────────────────────────────────────────

  /**
   * Valide les params d'une requête JSON-RPC via Zod.
   * Retourne soit { data } (succès) soit une JsonRpcResponse d'erreur (à retourner tel quel).
   */
  private validateParams<T extends z.ZodTypeAny>(
    schema: T,
    params: unknown,
    id: number | string | null | undefined,
  ): { ok: true; data: z.infer<T> } | { ok: false; response: JsonRpcResponse } {
    const result = schema.safeParse(params ?? {});
    if (!result.success) {
      return {
        ok: false,
        response: {
          jsonrpc: '2.0',
          id: id ?? null,
          error: {
            ...JSON_RPC_ERRORS.INVALID_PARAMS,
            data: result.error.issues,
          },
        },
      };
    }
    return { ok: true, data: result.data as z.infer<T> };
  }

  private respondError(
    res: http.ServerResponse,
    id: number | string | null,
    error: { code: number; message: string; data?: unknown },
  ): void {
    this.writeJson(res, 200, { jsonrpc: '2.0', id, error });
  }

  private buildErrorResponse(
    id: number | string | null,
    err: unknown,
  ): JsonRpcResponse {
    const error = err as Error & { code?: number };
    return {
      jsonrpc: '2.0',
      id,
      error: {
        code: error.code ?? JSON_RPC_ERRORS.INTERNAL_ERROR.code,
        message: error.message ?? 'Internal error',
      },
    };
  }

  private readBody(req: http.IncomingMessage, maxBytes?: number): Promise<string> {
    const limit = maxBytes ?? this.parseBodyLimit(this.config.jsonBodyLimit);
    return new Promise((resolve, reject) => {
      const chunks: Buffer[] = [];
      let total = 0;
      req.on('data', (chunk: Buffer) => {
        total += chunk.length;
        if (total > limit) {
          req.destroy();
          reject(Object.assign(new Error('Request body too large'), { code: 'EBODYTOOLARGE' }));
          return;
        }
        chunks.push(chunk);
      });
      req.on('end', () => resolve(Buffer.concat(chunks).toString('utf-8')));
      req.on('error', reject);
    });
  }

  /**
   * Parse "10mb" / "1gb" en bytes.
   */
  private parseBodyLimit(limit?: string): number {
    if (!limit) return 10 * 1024 * 1024; // 10mb default
    const m = limit.match(/^(\d+(?:\.\d+)?)\s*(b|kb|mb|gb)?$/i);
    if (!m) return 10 * 1024 * 1024;
    const num = Number(m[1]);
    const unit = (m[2] ?? 'b').toLowerCase();
    const mult: Record<string, number> = { b: 1, kb: 1024, mb: 1024 ** 2, gb: 1024 ** 3 };
    return Math.floor(num * (mult[unit] ?? 1));
  }

  /**
   * Parse le retour de agent_control pour extraire le status de l'agent distant.
   */
  private parseAgentControlStatus(result: { content: Array<{ type: string; text: string }> }): 'running' | 'done' | 'failed' | 'orphaned' | 'unknown' {
    const text = result.content.map((c) => c.text).join('\n').toLowerCase();
    if (text.includes('running') || text.includes('status: running')) return 'running';
    if (text.includes('done') || text.includes('completed')) return 'done';
    if (text.includes('failed') || text.includes('error')) return 'failed';
    if (text.includes('orphaned') || text.includes('offline')) return 'orphaned';
    return 'unknown';
  }
}

// ─── Safe Stats wrapper inline (déclaré ici pour éviter d'augmenter MessageLog) ───
// (Voir handleHealth — try/catch sur this.messageLog.stats())
