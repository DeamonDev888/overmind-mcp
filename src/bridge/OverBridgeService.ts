/**
 * ╔══════════════════════════════════════════════════════════════════════╗
 * ║   OVERMIND BRIDGE — OverBridgeService (Base Client SDK Wrapper)      ║
 * ║                                                                      ║
 * ║   [SCRIPT DE BASE - CLIENT SDK WRAPPER]                              ║
 * ║   API haut niveau pour interagir avec les agents, la mémoire, les    ║
 * ║   runs, et les sessions. Wrappe BridgeProxy pour offrir une          ║
 * ║   interface client simple et robuste (SDK).                          ║
 * ║                                                                      ║
 * ║   ARCHITECTURE                                                       ║
 * ║   ─────────────                                                      ║
 * ║   App/Client SDK → OverBridgeService → BridgeProxy → Overmind MCP    ║
 * ╚══════════════════════════════════════════════════════════════════════╝
 */

import type {
  AgentResult,
  RunAgentOptions,
  AgentControlOptions,
  MemorySearchOptions,
  MemoryStoreOptions,
  MemoryRunsOptions,
  UpdateAgentConfigOptions,
  CreatePromptOptions,
  EditPromptOptions,
  BridgeConfig,
  SessionState,
  RunnerType,
  HealthStatus,
} from './types.js';
import { BridgeProxy } from './BridgeProxy.js';
import {
  extractSessionIdFromContent,
  validatePrompt,
  validateAgentName,
  formatDiscordContext,
  type BridgeLogger,
} from './utils.js';

// ─── OverBridgeService ─────────────────────────────────────────────────────

export class OverBridgeService {
  private readonly proxy: BridgeProxy;
  private session: SessionState;
  private heartbeatInterval: ReturnType<typeof setInterval> | undefined;

  constructor(config?: Partial<BridgeConfig>, logger?: BridgeLogger, initialSessionId?: string) {
    this.proxy = new BridgeProxy(config, undefined, logger);
    this.session = {
      currentSessionId: initialSessionId,
      lastActivityAt: Date.now(),
      messageCount: 0,
    };
  }

  get proxyAccess(): BridgeProxy {
    return this.proxy;
  }

  get sessionId(): string | undefined {
    return this.session.currentSessionId;
  }

  get sessionInfo(): SessionState {
    return { ...this.session };
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // LIFECYCLE & HEARTBEAT
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Initialise la connexion au serveur MCP, vérifie la santé initiale
   * et configure un heartbeat périodique avec auto-reconnect.
   *
   * Fix #3: Si le ping échoue, on reset le circuit breaker et on
   * réessaie de se reconnecter au lieu d'attendre un redémarrage manuel.
   */
  async connect(healthCheckIntervalMs?: number): Promise<HealthStatus> {
    this.proxy.log.info('🔌 Connecting to Overmind MCP server...');
    const status = await this.proxy.healthCheck();
    this.proxy.log.info(`🔌 Status: ${status.status} (latency: ${status.latencyMs ?? '?'}ms)`);

    if (healthCheckIntervalMs) {
      if (this.heartbeatInterval) {
        clearInterval(this.heartbeatInterval);
      }
      let consecutiveFailures = 0;
      this.heartbeatInterval = setInterval(async () => {
        const pingStatus = await this.proxy.healthCheck();
        if (pingStatus.status === 'offline' || pingStatus.status === 'degraded') {
          consecutiveFailures++;
          this.proxy.log.warn(
            `💓 Heartbeat failed (${consecutiveFailures}x): ${pingStatus.status}`,
          );
          // After 2 consecutive failures, force circuit breaker reset + reconnect
          if (consecutiveFailures >= 2) {
            this.proxy.log.warn('🔁 Auto-reconnect: resetting circuit breaker and retrying...');
            this.proxy.forceReconnect();
            const retry = await this.proxy.healthCheck();
            if (retry.status === 'online') {
              consecutiveFailures = 0;
              this.proxy.log.info('🔁 Auto-reconnect: SUCCESS — server is back online');
            } else {
              this.proxy.log.error('🔁 Auto-reconnect: FAILED — will retry next heartbeat');
            }
          }
        } else {
          if (consecutiveFailures > 0) {
            this.proxy.log.info(`💓 Heartbeat recovered after ${consecutiveFailures} failures`);
          }
          consecutiveFailures = 0;
          this.proxy.log.debug(`💓 Heartbeat: ${pingStatus.status}`);
        }
      }, healthCheckIntervalMs);
    }

    return status;
  }

  /**
   * Ferme proprement le service en annulant le heartbeat actif.
   */
  disconnect(): void {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = undefined;
      this.proxy.log.info('🔌 Disconnected and stopped heartbeat.');
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // SESSION MANAGEMENT
  // ═══════════════════════════════════════════════════════════════════════════

  /** Force un reset de session — le prochain appel démarre une nouvelle session */
  resetSession(): void {
    this.proxy.log.info('🔄 Session reset');
    this.session.currentSessionId = undefined;
    this.session.messageCount = 0;
  }

  /** Force un sessionId spécifique (ex: reçu d'un env var) */
  setSession(id: string): void {
    this.session.currentSessionId = id;
    this.session.lastActivityAt = Date.now();
    this.proxy.log.info(`🔗 Session set: ${id}`);
  }

  private updateSession(newId?: string): void {
    if (newId) {
      this.session.currentSessionId = newId;
    }
    this.session.lastActivityAt = Date.now();
    this.session.messageCount++;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // AGENT EXECUTION
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Exécute un agent via `run_agent`.
   * Gère automatiquement la session continuity.
   * Injecte les defaultMcpServers du BridgeProxy si l'appelant n'en fournit pas
   * (héritage mémoire — l'agent a toujours accès au MCP memory).
   */
  async runAgent(options: RunAgentOptions): Promise<AgentResult> {
    validatePrompt(options.prompt);
    validateAgentName(options.agentName);

    const args: Record<string, unknown> = {
      runner: options.runner,
      prompt: options.prompt,
      agentName: options.agentName,
      sessionId: this.session.currentSessionId || undefined,
      autoResume: options.autoResume ?? (this.session.currentSessionId ? false : true),
      silent: options.silent ?? false,
      // Héritage mémoire: injecter les MCP servers par défaut du proxy
      mcp_servers: this.proxy.defaultMcpServers,
    };
    if (options.path) args.path = options.path;
    if (options.model) args.model = options.model;
    if (options.mode) args.mode = options.mode;
    if (options.config) args.config = options.config;

    try {
      const result = await this.proxy.call('run_agent', args, this.proxy.agentTimeout);
      return this._processAgentResponse(result);
    } catch (err) {
      const error = err as Error & { code?: string; timeoutMs?: number };
      // Timeout = agent travaille toujours, pas une erreur fatale
      if (error?.code === 'ETIMEDOUT' || error?.code === 'EBODYREAD') {
        this.proxy.log.warn(`⏱️ Agent timeout (${error.code}) — ${options.agentName}`);
        // Met à jour lastActivityAt + messageCount pour ne pas perdre
        // la trace de session (l'agent a peut-être déjà créé un
        // sessionId côté MCP, on garde l'ancien).
        this.updateSession();
        return {
          content: [
            {
              type: 'text',
              text: `⏱️ **Timeout — l'agent travaille toujours.**\n\nL'agent a besoin de plus de temps pour cette tâche.\nUtilise \`agent_control(status)\` pour vérifier.`,
            },
          ],
          isError: false,
          sessionId: this.session.currentSessionId,
        };
      }
      throw err;
    }
  }

  /**
   * Raccourci : run agent avec contexte Discord auto-formaté.
   */
  async runAgentForDiscord(
    agentName: string,
    runner: RunnerType,
    message: string,
    discordContext: { channelId?: string; userId?: string; username?: string },
  ): Promise<AgentResult> {
    const prompt = formatDiscordContext({ ...discordContext, message });
    return this.runAgent({ runner, prompt, agentName });
  }

  private _processAgentResponse(result: import('./types.js').McpResponse): AgentResult {
    if (result.error) {
      return {
        content: [
          { type: 'text', text: `MCP Error ${result.error.code}: ${result.error.message}` },
        ],
        isError: true,
      };
    }

    const content = result.result?.content || [];
    const isError = result.result?.isError || false;

    // Extraction sessionId — 3 sources : result, contenu textuel, conservation
    let foundId = result.result?.sessionId as string | undefined;
    if (!foundId) foundId = extractSessionIdFromContent(content);
    if (!foundId && this.session.currentSessionId) {
      this.proxy.log.info('🔒 No new sessionId — keeping previous');
      foundId = this.session.currentSessionId;
    }

    this.updateSession(foundId);
    return { content, isError, sessionId: foundId };
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // AGENT CONTROL
  // ═══════════════════════════════════════════════════════════════════════════

  /** Status d'un agent en cours */
  async agentStatus(options: AgentControlOptions): Promise<AgentResult> {
    const result = await this.proxy.call('agent_control', {
      agentName: options.agentName,
      action: options.action,
      runner: options.runner,
      sinceTimestamp: options.sinceTimestamp,
      timeoutMs: options.timeoutMs,
    });
    return this._processAgentResponse(result);
  }

  /** Kill un agent */
  async killAgent(agentName: string, runner?: RunnerType): Promise<AgentResult> {
    return this.agentStatus({ agentName, action: 'kill', runner });
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // MEMORY
  // ═══════════════════════════════════════════════════════════════════════════

  /** Recherche sémantique dans la mémoire Overmind */
  async memorySearch(options: MemorySearchOptions): Promise<AgentResult> {
    const result = await this.proxy.call('memory_search', {
      query: options.query,
      agent_name: options.agent_name,
      limit: options.limit ?? 10,
      include_runs: options.include_runs ?? false,
    });
    return this._processAgentResponse(result);
  }

  /** Stocke une connaissance dans la mémoire Overmind */
  async memoryStore(options: MemoryStoreOptions): Promise<AgentResult> {
    const result = await this.proxy.call('memory_store', {
      text: options.text,
      agent_name: options.agent_name,
      source: options.source ?? 'user',
    });
    return this._processAgentResponse(result);
  }

  /** Historique et statistiques des runs en mémoire */
  async memoryRuns(options?: MemoryRunsOptions): Promise<AgentResult> {
    const result = await this.proxy.call('memory_runs', {
      runner: options?.runner,
      limit: options?.limit,
      stats: options?.stats,
      agent_name: options?.agent_name,
    });
    return this._processAgentResponse(result);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // AGENTS MANAGEMENT
  // ═══════════════════════════════════════════════════════════════════════════

  /** Liste tous les agents disponibles */
  async listAgents(details = false): Promise<AgentResult> {
    const result = await this.proxy.call('list_agents', { details });
    return this._processAgentResponse(result);
  }

  /** Crée un nouvel agent */
  async createAgent(
    name: string,
    runner: RunnerType,
    prompt: string,
    model?: string,
    copyEnvFrom?: string,
    mode?: string,
    cliPath?: string,
  ): Promise<AgentResult> {
    const args: Record<string, unknown> = { name, runner, prompt };
    if (model) args.model = model;
    if (copyEnvFrom) args.copyEnvFrom = copyEnvFrom;
    if (mode) args.mode = mode;
    if (cliPath) args.cliPath = cliPath;

    const result = await this.proxy.call('create_agent', args);
    return this._processAgentResponse(result);
  }

  /** Supprime un agent */
  async deleteAgent(name: string): Promise<AgentResult> {
    const result = await this.proxy.call('delete_agent', { name });
    return this._processAgentResponse(result);
  }

  /** Récupère la configuration détaillée d'un agent */
  async getAgentConfigs(name: string): Promise<AgentResult> {
    const result = await this.proxy.call('get_agent_configs', { name });
    return this._processAgentResponse(result);
  }

  /** Met à jour la configuration d'un agent */
  async updateAgentConfig(options: UpdateAgentConfigOptions): Promise<AgentResult> {
    const result = await this.proxy.call('update_agent_config', {
      name: options.name,
      model: options.model,
      mcpServers: options.mcpServers,
      env: options.env,
      runner: options.runner,
      mode: options.mode,
      cliPath: options.cliPath,
      file: options.file,
      content: options.content,
    });
    return this._processAgentResponse(result);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // PROMPTS MANAGEMENT
  // ═══════════════════════════════════════════════════════════════════════════

  /** Crée ou écrase un fichier prompt */
  async createPrompt(options: CreatePromptOptions): Promise<AgentResult> {
    const result = await this.proxy.call('create_prompt', {
      name: options.name,
      content: options.content,
    });
    return this._processAgentResponse(result);
  }

  /** Modifie un prompt par recherche-remplacement */
  async editPrompt(options: EditPromptOptions): Promise<AgentResult> {
    const result = await this.proxy.call('edit_prompt', {
      name: options.name,
      search: options.search,
      replace: options.replace,
    });
    return this._processAgentResponse(result);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // PARALLEL EXECUTION
  // ═══════════════════════════════════════════════════════════════════════════

  /** Lance plusieurs agents en parallèle via run_agents_parallel */
  async runParallel(
    agents: Array<{
      taskId?: string;
      runner: RunnerType;
      prompt: string;
      agentName: string;
      path?: string;
      model?: string;
      mode?: string;
    }>,
    waitAll = true,
  ): Promise<AgentResult> {
    const result = await this.proxy.call(
      'run_agents_parallel',
      {
        agents: agents.map((a) => ({
          runner: a.runner,
          prompt: a.prompt,
          agentName: a.agentName,
          taskId: a.taskId,
          path: a.path,
          model: a.model,
          mode: a.mode,
        })),
        waitAll,
      },
      undefined,
    );
    return this._processAgentResponse(result);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // BATCH OPERATIONS
  // ═══════════════════════════════════════════════════════════════════════════

  /** Recherche séquentielle groupée en mémoire */
  async batchSearch(queries: string[], agentName?: string, limit?: number): Promise<AgentResult[]> {
    const results: AgentResult[] = [];
    for (const query of queries) {
      results.push(await this.memorySearch({ query, agent_name: agentName, limit }));
    }
    return results;
  }

  /** Stockage séquentiel groupé en mémoire */
  async batchStore(
    texts: Array<{ text: string; source?: 'user' | 'agent' | 'pattern' | 'error' | 'decision' }>,
    agentName?: string,
  ): Promise<AgentResult[]> {
    const results: AgentResult[] = [];
    for (const t of texts) {
      results.push(
        await this.memoryStore({ text: t.text, agent_name: agentName, source: t.source }),
      );
    }
    return results;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // CONVENIENCE
  // ═══════════════════════════════════════════════════════════════════════════

  /** Appel MCP raw — pour les tools non wrappés */
  async rawCall(
    toolName: string,
    args: Record<string, unknown>,
    timeoutMs?: number,
  ): Promise<AgentResult> {
    const result = await this.proxy.call(toolName, args, timeoutMs);
    return this._processAgentResponse(result);
  }
}
