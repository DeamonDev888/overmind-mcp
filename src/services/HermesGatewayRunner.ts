/**
 * HermesGatewayRunner — HTTP-based runner for the Hermes API Server.
 *
 * ╔══════════════════════════════════════════════════════════════════════╗
 * ║  ARCHITECTURE (v3.5 — Gateway Integration)                           ║
 * ║                                                                      ║
 * ║  Replaces the subprocess spawn in HermesRunner with HTTP+SSE calls    ║
 * ║  to the Hermes API Server (gateway/platforms/api_server.py).          ║
 * ║                                                                      ║
 * ║  BENEFITS over HermesRunner (spawn):                                 ║
 * ║    - No Python startup per call (~5-10s saved)                        ║
 * ║    - SSE streaming output in real-time                                ║
 * ║    - Native session management via X-Hermes-Session-Id header         ║
 * ║    - Proper abort via fetch AbortController                           ║
 * ║    - Model/provider swap via config, not CLI flags                    ║
 * ║                                                                      ║
 * ║  ENDPOINTS USED:                                                     ║
 * ║    POST /v1/chat/completions   → main chat (streaming SSE or JSON)   ║
 * ║    GET  /health                → connectivity check                  ║
 * ║                                                                      ║
 * ║  FALLBACK:                                                           ║
 * ║    If the API server is not running, falls back to HermesRunner       ║
 * ║    (subprocess spawn) for backward compatibility.                    ║
 * ╚══════════════════════════════════════════════════════════════════════╝
 */

import { HermesGatewayManager, type GatewayInfo } from './HermesGatewayManager.js';
import {
  registerLiveAgent,
  appendLiveOutput,
  setLiveStatus,
  unregisterLiveAgent,
} from '../lib/agent_lifecycle.js';
import { registerProcess } from '../lib/processRegistry.js';
import { withSpan } from '../lib/telemetry.js';
import { rootLogger } from '../lib/logger.js';
import { saveSessionId, getLastSessionId } from '../lib/sessions.js';
import { getWorkspaceDir } from '../lib/config.js';

const logger = rootLogger.child({ module: 'HermesGatewayRunner' });

export interface GatewayRunOptions {
  prompt: string;
  agentName?: string;
  sessionId?: string;
  autoResume?: boolean;
  model?: string;
  provider?: string;
  signal?: AbortSignal;
  silent?: boolean;
  /** Profile name for Hermes (maps to -p flag in spawn mode) */
  profile?: string;
}

export interface GatewayRunResult {
  result: string;
  sessionId?: string;
  error?: string;
  rawOutput?: string;
  model?: string;
  /** How the run was executed */
  transport: 'gateway-http' | 'fallback-spawn';
}

/** Pseudo-PID for gateway runs (no real OS process to track) */
let gatewayPidCounter = 70000;

/** In-memory session map for gateway runs: agentName → sessionId */
const gatewaySessions = new Map<string, string>();

/**
 * Runner that talks to the Hermes API Server via HTTP+SSE.
 *
 * Falls back to HermesRunner (subprocess spawn) if the API server is not
 * available — ensuring zero downtime during the migration.
 */
export class HermesGatewayRunner {
  private manager: HermesGatewayManager;

  constructor() {
    this.manager = HermesGatewayManager.getInstance();
  }

  /**
   * Run a prompt against the Hermes API Server.
   *
   * If the server is not reachable, returns an error with transport='fallback-spawn'
   * so the caller can decide to use the old HermesRunner.
   */
  async runAgent(options: GatewayRunOptions): Promise<GatewayRunResult> {
    const { agentName } = options;
    let { sessionId } = options;

    // ─── Resolve session ──────────────────────────────────────────────────
    if (options.autoResume && agentName && !sessionId) {
      // Try in-memory gateway sessions first
      const gwSession = gatewaySessions.get(agentName);
      if (gwSession) {
        sessionId = gwSession;
      } else {
        // Fall back to persisted sessions (from spawn mode)
        const lastId = await getLastSessionId(agentName, getWorkspaceDir(), 'hermes');
        if (lastId) {
          sessionId = lastId;
          logger.info({ sessionId }, '[GatewayRunner] Auto-resume from persisted sessions.');
        }
      }
    }

    return withSpan(
      'hermes.gateway.runAgent',
      async (span) => {
        span.setAttribute('agentName', agentName || '');
        span.setAttribute('transport', 'gateway-http');

        // ─── Ensure gateway is ready ──────────────────────────────────────
        const gw = await this.manager.ensureReady();
        if (!gw) {
          return {
            result: '',
            error: 'GATEWAY_NOT_READY',
            transport: 'fallback-spawn' as const,
          };
        }

        // ─── Register a pseudo-agent for lifecycle tracking ───────────────
        const pseudoPid = ++gatewayPidCounter;
        const abortController = new AbortController();

        registerLiveAgent({
          pid: pseudoPid,
          runner: 'hermes-gateway',
          agentName: agentName || 'anonymous',
          sessionId: sessionId || '',
          abortController,
          cleanupFn: async () => {
            abortController.abort();
          },
          childRef: null, // No child process — HTTP-based
        });

        // Also register in processRegistry for cross-system visibility
        void registerProcess(pseudoPid, {
          agentName: agentName || '',
          runner: 'hermes-gateway',
          configPath: getWorkspaceDir(),
        });

        try {
          const result = await this.executeChat(gw, options, sessionId, pseudoPid, abortController.signal);

          // Save session linkage
          if (result.sessionId && agentName) {
            gatewaySessions.set(agentName, result.sessionId);
            await saveSessionId(agentName, result.sessionId, getWorkspaceDir(), 'hermes');
          }

          setLiveStatus(pseudoPid, result.error ? 'failed' : 'done', result.error ? 1 : 0);
          return result;
        } catch (error) {
          const errMsg = error instanceof Error ? error.message : String(error);
          logger.error({ error: errMsg, agentName }, '[GatewayRunner] Run failed.');
          setLiveStatus(pseudoPid, 'failed', 1);
          return {
            result: '',
            error: `GATEWAY_ERROR: ${errMsg}`,
            transport: 'gateway-http',
          };
        } finally {
          unregisterLiveAgent(pseudoPid);
        }
      },
      { agentName: agentName || '', transport: 'gateway-http' },
    );
  }

  /**
   * Execute a chat completion against the API server.
   *
   * Uses streaming SSE to get real-time output, assembling the final
   * text from delta chunks.
   */
  private async executeChat(
    gw: GatewayInfo,
    options: GatewayRunOptions,
    sessionId: string | undefined,
    pseudoPid: number,
    externalSignal: AbortSignal,
  ): Promise<GatewayRunResult> {
    const { prompt, agentName, silent } = options;

    // Build request headers
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${gw.apiKey}`,
    };

    // Session management via header
    if (sessionId) {
      headers['X-Hermes-Session-Id'] = sessionId;
    }

    // Profile selection via header (maps to -p <profile>)
    const profile = options.profile || agentName;
    if (profile && profile !== 'default') {
      headers['X-Hermes-Profile'] = profile;
    }

    // Build request body (OpenAI chat completions format)
    const body: Record<string, unknown> = {
      model: options.model || 'hermes-agent',
      messages: [{ role: 'user', content: prompt }],
      stream: true, // Always stream — we assemble the final text
    };

    // Combine abort signals
    const combinedSignal = externalSignal;

    logger.info(
      { url: gw.url, agentName, sessionId: sessionId?.slice(0, 20), profile },
      '[GatewayRunner] POST /v1/chat/completions (streaming)',
    );

    const response = await fetch(`${gw.url}/v1/chat/completions`, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal: combinedSignal,
    });

    if (!response.ok) {
      const errText = await response.text().catch(() => '(no body)');
      return {
        result: '',
        error: `HTTP_${response.status}: ${errText.slice(0, 500)}`,
        transport: 'gateway-http',
      };
    }

    // ─── Parse SSE stream ────────────────────────────────────────────────
    const fullText = await this.parseSSEStream(response, pseudoPid, silent, agentName);

    // Extract session ID from response headers
    const responseSessionId = response.headers.get('x-hermes-session-id') || undefined;

    return {
      result: fullText.trim(),
      sessionId: responseSessionId || sessionId,
      rawOutput: fullText,
      model: options.model,
      transport: 'gateway-http',
    };
  }

  /**
   * Parse the SSE stream from /v1/chat/completions.
   *
   * Format (OpenAI-compatible):
   *   data: {"choices":[{"delta":{"content":"hello"}}]}
   *   data: {"choices":[{"delta":{"content":" world"}}]}
   *   data: [DONE]
   *
   * Assembles full text, streams chunks to agent_lifecycle in real-time.
   */
  private async parseSSEStream(
    response: Response,
    pseudoPid: number,
    silent: boolean | undefined,
    agentName: string | undefined,
  ): Promise<string> {
    let fullText = '';
    const reader = response.body?.getReader();
    if (!reader) {
      throw new Error('No response body for SSE stream');
    }

    const decoder = new TextDecoder();
    let buffer = '';

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });

        // Process complete SSE events (separated by \n\n)
        const events = buffer.split('\n\n');
        buffer = events.pop() || ''; // Keep incomplete chunk in buffer

        for (const event of events) {
          const line = event.trim();
          if (!line.startsWith('data: ')) continue;

          const data = line.slice(6); // Remove "data: " prefix

          // End of stream
          if (data === '[DONE]') continue;

          try {
            const parsed = JSON.parse(data);
            const delta = parsed.choices?.[0]?.delta;

            if (delta?.content) {
              const chunk = delta.content as string;
              fullText += chunk;

              // Stream to agent_lifecycle for real-time output
              appendLiveOutput(pseudoPid, chunk);

              // Also write to stderr for live monitoring (matching HermesRunner pattern)
              if (!silent && agentName) {
                process.stderr.write(`[HermesGW:${agentName}] ${chunk}`);
              }
            }
          } catch {
            // Non-JSON line (e.g., comments) — skip
          }
        }
      }
    } finally {
      reader.releaseLock?.();
    }

    return fullText;
  }
}
