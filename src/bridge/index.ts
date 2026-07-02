/**
 * ╔══════════════════════════════════════════════════════════════════════╗
 * ║   OVERMIND BRIDGE — Barrel Export                                    ║
 * ║   Expose les APIs client, serveur, et les types associés             ║
 * ╚══════════════════════════════════════════════════════════════════════╝
 */

// ─── Client SDK / Scripts de Base ─────────────────────────────────────────
export { BridgeProxy } from './BridgeProxy.js';
export { OverBridgeService } from './OverBridgeService.js';
export { BridgeHttpClient } from './BridgeHttpClient.js';
export type {
  BridgeHttpClientConfig,
  JsonRpcCallRequest,
  JsonRpcCallResponse,
} from './BridgeHttpClient.js';

// ─── Server API ──────────────────────────────────────────────────────────
export { OverBridgeServer } from './OverBridgeServer.js';
export type {
  OverBridgeServerConfig,
  JsonRpcRequest,
  JsonRpcResponse,
} from './OverBridgeServer.js';

// ─── CLI Components ──────────────────────────────────────────────────────
export { parseArgs, getFlag, requireFlag, hasStdinData, readStdin } from './ArgParser.js';
export type { ParsedArgs, ArgValue } from './ArgParser.js';
export { resolvePrompt, parseVars } from './PromptSource.js';
export type { ResolvePromptOptions, ResolvedPrompt, PromptSource } from './PromptSource.js';
export { loadScenario, runScenario } from './ScenarioLoader.js';
export type {
  Scenario,
  ScenarioStep,
  RunStep,
  A2AStep,
  ParallelStep,
  ConditionalStep,
  WaitStep,
  StepResult,
  ScenarioRunnerContext,
} from './ScenarioLoader.js';

// ─── Server Components ───────────────────────────────────────────────────
export { AgentRegistry } from './AgentRegistry.js';
export type { AgentLiveState, AgentLiveStatus, ListAgentsFilter } from './AgentRegistry.js';
export { MessageLog, loadMessageLogConfigFromEnv } from './MessageLog.js';
export type {
  PersistedMessage,
  MessageStatus,
  CreateMessageInput,
  ListMessagesFilter,
  MessageLogConfig,
} from './MessageLog.js';
export { SessionStore } from './SessionStore.js';
export type { SessionEntry, SessionStoreConfig } from './SessionStore.js';
export { DirectiveParser, parseKeyValueArgs } from './DirectiveParser.js';
export type {
  DirectiveAction,
  ParsedDirectives,
  DirectiveParserOptions,
} from './DirectiveParser.js';
export { WebhookAdapter } from './WebhookAdapter.js';
export type { NormalizedWebhook, WebhookProvider, WebhookAdapterConfig } from './WebhookAdapter.js';
export { sanitizeAndParse, sanitizeJsonRaw, looksLikeWindowsPathIssue } from './JsonSanitizer.js';
export { newRequestId, getOrCreateRequestId } from './RequestContext.js';

// ─── Types ────────────────────────────────────────────────────────────────
export * from './types.js';

// ─── Utilities ────────────────────────────────────────────────────────────
export {
  createBridgeLogger,
  parseMcpResponseBody,
  validatePrompt,
  validateAgentName,
  formatDiscordContext,
  type BridgeLogger,
  type LogLevel,
} from './utils.js';
