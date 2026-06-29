#!/usr/bin/env node
/**
 * ╔══════════════════════════════════════════════════════════════════════╗
 * ║   OVERMIND BRIDGE — CLI (overmind-bridge)                            ║
 * ║                                                                      ║
 * ║   Point d'entrée unifié pour le bridge Overmind.                     ║
 * ║   Supporte 8 subcommands : server, call, scenario, replay, status,   ║
 * ║   health, send, agent.                                               ║
 * ║                                                                      ║
 * ║   USAGE EXAMPLES                                                      ║
 * ║   ──────────────                                                      ║
 * ║   # Start server                                                      ║
 * ║   overmind-bridge server --port 3100                                 ║
 * ║                                                                      ║
 * ║   # One-shot agent call (8 prompt sources)                            ║
 * ║   overmind-bridge call agent.run --agent scout --runner kilo \        ║
 * ║       --prompt "Analyse BTC"                                         ║
 * ║   echo "Analyse BTC" | overmind-bridge call agent.run \              ║
 * ║       --agent scout --runner kilo --prompt-stdin                    ║
 * ║   overmind-bridge call agent.run --agent scout --runner kilo \        ║
 * ║       --prompt-file ./brief.txt --var ticker=BTC                     ║
 * ║                                                                      ║
 * ║   # A2A — agent A parle à agent B                                    ║
 * ║   overmind-bridge call agent.a2a \                                    ║
 * ║       --from scout --to analyst --runner kilo \                      ║
 * ║       --prompt "Valide mon analyse"                                  ║
 * ║                                                                      ║
 * ║   # Multi-agent scenario from JSON                                   ║
 * ║   overmind-bridge scenario ./workflow.json --var ticker=BTC          ║
 * ║                                                                      ║
 * ║   # Replay a failed message                                          ║
 * ║   overmind-bridge replay --id 7f3e8a1b-...                            ║
 * ║                                                                      ║
 * ║   # Status of all agents                                              ║
 * ║   overmind-bridge status                                             ║
 * ║                                                                      ║
 * ║   # Server health                                                     ║
 * ║   overmind-bridge health                                              ║
 * ╚══════════════════════════════════════════════════════════════════════╝
 */

import { parseArgs, requireFlag, getFlag, type ParsedArgs } from '../bridge/ArgParser.js';
import { resolvePrompt, parseVars } from '../bridge/PromptSource.js';
import { loadScenario, runScenario, type StepResult } from '../bridge/ScenarioLoader.js';
import { BridgeHttpClient } from '../bridge/BridgeHttpClient.js';
import {
  OverBridgeService,
  OverBridgeServer,
  loadMessageLogConfigFromEnv,
  createBridgeLogger,
} from '../bridge/index.js';

const log = createBridgeLogger('overmind-bridge');
const clog = (msg: string) => log.info(msg);

// ─── Entry Point ───────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const args = parseArgs();
  const command = args.command ?? 'help';

  try {
    switch (command) {
      case 'server':
        await cmdServer(args);
        break;
      case 'call':
        await cmdCall(args);
        break;
      case 'scenario':
        await cmdScenario(args);
        break;
      case 'replay':
        await cmdReplay(args);
        break;
      case 'status':
        await cmdStatus(args);
        break;
      case 'health':
        await cmdHealth(args);
        break;
      case 'agents':
      case 'agent':
        await cmdAgents(args);
        break;
      case 'history':
        await cmdHistory(args);
        break;
      case 'sessions':
      case 'session':
        await cmdSessions(args);
        break;
      case 'webhook':
        await cmdWebhook(args);
        break;
      case 'send':
        await cmdSend(args);
        break;
      case 'version':
      case '--version':
      case '-v':
        console.log('overmind-bridge 1.0.0');
        break;
      case 'help':
      case '--help':
      case '-h':
      case undefined:
        printHelp();
        break;
      default:
        console.error(`❌ Unknown command: ${command}`);
        console.error(`Run 'overmind-bridge help' for usage.`);
        process.exit(1);
    }
  } catch (err) {
    console.error(`💥 ${command} failed: ${(err as Error).message}`);
    if (process.env.DEBUG) {
      console.error((err as Error).stack);
    }
    process.exit(1);
  }
}

// ─── Subcommand: server ────────────────────────────────────────────────────

async function cmdServer(args: ParsedArgs): Promise<void> {
  const port = Number(getFlag(args, 'port', 3100));
  const host = String(getFlag(args, 'host', '127.0.0.1'));
  const authToken = getFlag<string>(args, 'auth-token') ?? process.env.BRIDGE_AUTH_TOKEN;
  const enableLog = getFlag(args, 'no-log', undefined) === undefined; // --no-log désactive
  const healthInterval = Number(getFlag(args, 'health-interval', 30_000));
  const mcpUrl = String(getFlag(args, 'mcp-url', process.env.MCP_URL ?? 'http://localhost:3099/mcp'));
  const enableSessionStore = getFlag(args, 'no-session-store', undefined) === undefined;
  const enableDirectives = getFlag(args, 'no-directives', undefined) === undefined;
  const enableWebhooks = getFlag(args, 'webhooks', false) as boolean;
  const enableSanitize = getFlag(args, 'sanitize-json', true) as boolean;
  const sessionTtlMs = Number(getFlag(args, 'session-ttl', 4 * 60 * 60 * 1000));

  clog(`🚀 Starting OverBridgeServer on ${host}:${port}`);
  clog(`   MCP upstream: ${mcpUrl}`);
  clog(`   MessageLog: ${enableLog ? 'enabled' : 'disabled'}`);
  clog(`   SessionStore: ${enableSessionStore ? 'enabled' : 'disabled'}`);
  clog(`   Directives: ${enableDirectives ? 'enabled' : 'disabled'}`);
  clog(`   Webhooks: ${enableWebhooks ? 'enabled' : 'disabled'}`);
  clog(`   Sanitize JSON: ${enableSanitize ? 'enabled' : 'disabled'}`);
  if (authToken) clog(`   Auth: enabled`);

  const service = new OverBridgeService({ mcpUrl });
  const server = new OverBridgeServer(
    service,
    {
      port,
      host,
      postgres: loadMessageLogConfigFromEnv(),
      enableMessageLog: enableLog,
      authToken,
      healthCheckIntervalMs: healthInterval,
      enableSessionStore,
      enableDirectives,
      enableWebhooks,
      sanitizeJson: enableSanitize,
      sessionTtlMs,
    },
    log,
  );

  const { url } = await server.start();

  console.log(`\n  OverBridgeServer ready at ${url}`);
  console.log(`  POST ${url}/rpc   (JSON-RPC 2.0)`);
  console.log(`  GET  ${url}/health`);
  if (enableWebhooks) {
    console.log(`  POST ${url}/webhook/:provider   (voipms, twilio, discord, generic)`);
  }
  console.log('');

  // Graceful shutdown
  const shutdown = async (signal: string) => {
    clog(`\n🛑 Received ${signal}, shutting down...`);
    await server.stop();
    process.exit(0);
  };
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));

  // Keep alive
  await new Promise(() => {});
}

// ─── Subcommand: call (one-shot JSON-RPC) ──────────────────────────────────

async function cmdCall(args: ParsedArgs): Promise<void> {
  // 2 formats acceptés:
  //   call <method> [--param1 v1 --param2 v2 ...]
  //   call --method <method> [--param1 v1 ...]
  const method = (args.positionals[0] ?? getFlag<string>(args, 'method')) as string | undefined;
  if (!method) {
    throw new Error('call requires a method (e.g. "call agent.run --agent scout ..." or "call --method agent.run ...")');
  }

  const client = getClient(args);

  // Prompt resolution (8 sources)
  const prompt = await resolvePrompt({
    prompt: getFlag<string>(args, 'prompt'),
    promptFile: getFlag<string>(args, 'prompt-file'),
    promptStdin: getFlag(args, 'prompt-stdin', false) as boolean | undefined,
    promptBase64: getFlag<string>(args, 'prompt-base64'),
    promptFileBase64: getFlag<string>(args, 'prompt-file-base64'),
    promptUrl: getFlag<string>(args, 'prompt-url'),
    promptJson: getFlag<string>(args, 'prompt-json'),
    promptTemplate: getFlag<string>(args, 'prompt-template'),
    vars: parseVars(getFlag<string | string[]>(args, 'var')),
  });

  // Construit les params dynamiquement depuis tous les flags non-préfixés
  const params: Record<string, unknown> = {};
  const reservedFlags = new Set([
    'method', 'server', 'port', 'host', 'auth-token', 'no-log', 'health-interval', 'mcp-url',
    'prompt', 'prompt-file', 'prompt-stdin', 'prompt-base64', 'prompt-file-base64',
    'prompt-url', 'prompt-json', 'prompt-template', 'var',
    'id', 'output', 'json', 'pretty',
  ]);
  for (const [k, v] of Object.entries(args.flags)) {
    if (!reservedFlags.has(k)) {
      params[k] = v;
    }
  }
  // Si prompt résolu, l'injecte (sauf si déjà fourni via params)
  if (prompt.text && !params.prompt) {
    params.prompt = prompt.text;
  }
  // Métadonnées (vars, prompt source)
  if (Object.keys(params).length > 0 || prompt.text) {
    const metadata: Record<string, unknown> = {
      promptSource: prompt.source,
      promptBytes: prompt.meta.bytes,
    };
    if (prompt.meta.origin) metadata.promptOrigin = prompt.meta.origin;
    params.metadata = { ...(params.metadata as Record<string, unknown> | undefined), ...metadata };
  }

  clog(`📞 ${method} → ${client.baseUrl}`);
  const result = await client.call(method, params, Number(getFlag(args, 'timeout', 600_000)));
  printResult(result, getFlag(args, 'pretty', false) as boolean);
}

// ─── Subcommand: send (alias pour call agent.run) ──────────────────────────

async function cmdSend(args: ParsedArgs): Promise<void> {
  // send est un raccourci : call agent.run avec les bons flags
  const agentName = requireFlag<string>(args, 'agent');
  const runner = requireFlag<string>(args, 'runner');
  const prompt = await resolvePrompt({
    prompt: getFlag<string>(args, 'prompt'),
    promptFile: getFlag<string>(args, 'prompt-file'),
    promptStdin: getFlag(args, 'prompt-stdin', true) as boolean,
    promptBase64: getFlag<string>(args, 'prompt-base64'),
    promptFileBase64: getFlag<string>(args, 'prompt-file-base64'),
    promptUrl: getFlag<string>(args, 'prompt-url'),
    promptJson: getFlag<string>(args, 'prompt-json'),
    promptTemplate: getFlag<string>(args, 'prompt-template'),
    vars: parseVars(getFlag<string | string[]>(args, 'var')),
  });

  const client = getClient(args);
  const result = await client.call('agent.run', {
    agentName,
    runner,
    prompt: prompt.text,
    sessionId: getFlag<string>(args, 'session'),
    model: getFlag<string>(args, 'model'),
    mode: getFlag<string>(args, 'mode'),
    path: getFlag<string>(args, 'path'),
    silent: getFlag(args, 'silent', false) as boolean,
  }, Number(getFlag(args, 'timeout', 600_000)));
  printResult(result, getFlag(args, 'pretty', false) as boolean);
}

// ─── Subcommand: scenario ──────────────────────────────────────────────────

async function cmdScenario(args: ParsedArgs): Promise<void> {
  const file = getFlag<string>(args, 'file') ?? args.positionals[0];
  if (!file) throw new Error('scenario requires --file <path.json> or positional <path.json>');

  const client = getClient(args);
  const scenario = await loadScenario(file);
  const inputVars = parseVars(getFlag<string | string[]>(args, 'var'));

  clog(`📜 Scenario: ${scenario.name} (${scenario.steps.length} steps)`);
  const results = await runScenario(scenario, {
    vars: inputVars,
    log: (msg: string) => clog(msg),
    runAgent: async (params: { agentName: string; runner: string; prompt: string; model?: string; mode?: string; path?: string }) => {
      const r = await client.call<{
        messageId?: string;
        sessionId?: string;
        content: Array<{ type: string; text: string }>;
        isError: boolean;
      }>('agent.run', params);
      return {
        text: r.content.map((c: { type: string; text: string }) => c.text).join('\n'),
        sessionId: r.sessionId,
        isError: r.isError,
        messageId: r.messageId,
      };
    },
    runA2A: async (params: { fromAgent: string; toAgent: string; runner: string; prompt: string; model?: string }) => {
      const r = await client.call<{
        messageId?: string;
        sessionId?: string;
        content: Array<{ type: string; text: string }>;
        isError: boolean;
      }>('agent.a2a', params);
      return {
        text: r.content.map((c: { type: string; text: string }) => c.text).join('\n'),
        sessionId: r.sessionId,
        isError: r.isError,
        messageId: r.messageId,
      };
    },
  });

  printResult({ scenario: scenario.name, results }, getFlag(args, 'pretty', false) as boolean);

  const allOk = results.every((r: StepResult) => r.success);
  if (!allOk) process.exit(2);
}

// ─── Subcommand: replay ────────────────────────────────────────────────────

async function cmdReplay(args: ParsedArgs): Promise<void> {
  const id = requireFlag<string>(args, 'id');
  const client = getClient(args);
  clog(`🔁 Replaying message ${id}...`);
  const result = await client.call('message.replay', { id }, Number(getFlag(args, 'timeout', 600_000)));
  printResult(result, getFlag(args, 'pretty', false) as boolean);
}

// ─── Subcommand: status (alias agent.list) ─────────────────────────────────

async function cmdStatus(args: ParsedArgs): Promise<void> {
  const client = getClient(args);
  const result = await client.call<{ agents: unknown[]; stats: unknown }>('agent.list', {
    status: getFlag<string>(args, 'status'),
    runner: getFlag<string>(args, 'runner'),
  });
  printResult(result, getFlag(args, 'pretty', false) as boolean);
}

// ─── Subcommand: agents (alias) ────────────────────────────────────────────

async function cmdAgents(args: ParsedArgs): Promise<void> {
  return cmdStatus(args);
}

// ─── Subcommand: health ────────────────────────────────────────────────────

async function cmdHealth(args: ParsedArgs): Promise<void> {
  const client = getClient(args);
  try {
    const result = await client.health();
    printResult(result, getFlag(args, 'pretty', false) as boolean);
  } catch (err) {
    console.error(`❌ Server unreachable: ${(err as Error).message}`);
    process.exit(1);
  }
}

// ─── Subcommand: history (alias message.history) ───────────────────────────

async function cmdHistory(args: ParsedArgs): Promise<void> {
  const client = getClient(args);
  const result = await client.call('message.history', {
    toAgent: getFlag<string>(args, 'to'),
    fromAgent: getFlag<string>(args, 'from'),
    status: getFlag<string>(args, 'status'),
    limit: Number(getFlag(args, 'limit', 50)),
    offset: Number(getFlag(args, 'offset', 0)),
    sinceHours: getFlag(args, 'since-hours', undefined) as number | undefined,
  });
  printResult(result, getFlag(args, 'pretty', false) as boolean);
}

// ─── Subcommand: sessions (multi-tenant) ─────────────────────────────────

async function cmdSessions(args: ParsedArgs): Promise<void> {
  const client = getClient(args);
  const method = args.positionals[1] ?? 'list';

  if (method === 'list' || method === 'stats') {
    const result = await client.call('session.list');
    printResult(result, getFlag(args, 'pretty', false) as boolean);
  } else if (method === 'get') {
    const result = await client.call('session.get', {
      externalKey: requireFlag<string>(args, 'key'),
      agentName: requireFlag<string>(args, 'agent'),
    });
    printResult(result, getFlag(args, 'pretty', false) as boolean);
  } else if (method === 'delete' || method === 'rm') {
    const result = await client.call('session.delete', {
      externalKey: requireFlag<string>(args, 'key'),
      agentName: requireFlag<string>(args, 'agent'),
    });
    printResult(result, getFlag(args, 'pretty', false) as boolean);
  } else {
    throw new Error(`Unknown session subcommand: ${method}. Use: list, get, delete`);
  }
}

// ─── Subcommand: webhook (envoi programmatique) ───────────────────────────

async function cmdWebhook(args: ParsedArgs): Promise<void> {
  const provider = String(getFlag(args, 'provider', 'voipms'));
  const client = getClient(args);

  // Payload depuis --payload-file ou --payload (JSON string)
  let payload: Record<string, unknown>;
  const payloadFile = getFlag<string>(args, 'payload-file');
  const payloadStr = getFlag<string>(args, 'payload');
  if (payloadFile) {
    const fs = await import('node:fs/promises');
    const raw = await fs.readFile(payloadFile, 'utf-8');
    payload = JSON.parse(raw) as Record<string, unknown>;
  } else if (payloadStr) {
    payload = JSON.parse(payloadStr) as Record<string, unknown>;
  } else {
    throw new Error('webhook requires --payload <json> or --payload-file <path>');
  }

  const autoDispatch = getFlag(args, 'agent')
    ? {
        agentName: requireFlag<string>(args, 'agent'),
        runner: requireFlag<string>(args, 'runner'),
        model: getFlag<string>(args, 'model'),
        mode: getFlag<string>(args, 'mode'),
      }
    : undefined;

  const result = await client.call('webhook.sms', {
    provider,
    payload,
    externalKey: getFlag<string>(args, 'key'),
    autoDispatch,
  });
  printResult(result, getFlag(args, 'pretty', false) as boolean);
}

// ─── Helpers ───────────────────────────────────────────────────────────────

function getClient(args: ParsedArgs): BridgeHttpClient {
  const serverUrl = String(
    getFlag(args, 'server', process.env.BRIDGE_URL ?? 'http://127.0.0.1:3100'),
  );
  const authToken = getFlag<string>(args, 'auth-token') ?? process.env.BRIDGE_AUTH_TOKEN;
  return new BridgeHttpClient({ baseUrl: serverUrl, authToken });
}

function printResult(result: unknown, pretty: boolean): void {
  if (pretty) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    console.log(JSON.stringify(result));
  }
}

// ─── Help ──────────────────────────────────────────────────────────────────

function printHelp(): void {
  console.log(`
overmind-bridge — Multi-agent orchestrator CLI

USAGE
  overmind-bridge <command> [options]

COMMANDS
  server       Start the HTTP JSON-RPC 2.0 server
  call         One-shot JSON-RPC call (use --method or positional)
  send         Shortcut for 'call agent.run'
  scenario     Run a multi-agent scenario from JSON/YAML
  status       List all known agents and their state
  history      Show persisted message history
  sessions     Manage multi-tenant sessions (list, get, delete)
  webhook      Send a webhook payload (voipms/twilio/discord/generic) and optionally auto-dispatch
  replay       Replay a failed/stuck message by ID
  health       Ping the server's /health endpoint
  version      Print version

COMMON OPTIONS
  --server <url>          Bridge server URL (default: http://127.0.0.1:3100)
                          or env BRIDGE_URL
  --auth-token <token>    Bearer token (or env BRIDGE_AUTH_TOKEN)
  --pretty                Pretty-print JSON output
  --timeout <ms>          RPC timeout in ms (default: 600000)
  --var <key=value>       Variable for templating (repeatable)

PROMPT SOURCES (for 'call' and 'send')
  --prompt "..."          Literal string
  --prompt-file <path>    Read from file
  --prompt-stdin          Read from stdin (auto-detect if TTY absent)
  --prompt-base64 "..."   Decode base64 string
  --prompt-file-base64    Decode base64 from file
  --prompt-url <url>      Fetch URL
  --prompt-json '{...}'   Parse JSON object, reformat as text
  --prompt-template "..." Use --var for interpolation

EXAMPLES
  # Server
  overmind-bridge server --port 3100 --auth-token secret

  # Agent call
  overmind-bridge call agent.run --agent scout --runner kilo \\
      --prompt "Analyse BTC"

  # From file with template
  overmind-bridge send --agent scout --runner kilo \\
      --prompt-file ./brief.txt --var ticker=BTC

  # A2A (agent-to-agent)
  overmind-bridge call agent.a2a --from scout --to analyst \\
      --runner kilo --prompt "Validate my analysis"

  # Multi-agent scenario
  overmind-bridge scenario ./workflow.json --var ticker=BTC

  # Status
  overmind-bridge status --status busy

  # Multi-tenant sessions
  overmind-bridge sessions list
  overmind-bridge sessions get --key "+14187207735" --agent pdf_bon_travail
  overmind-bridge sessions rm --key "+14187207735" --agent pdf_bon_travail

  # Webhook programmatic dispatch
  overmind-bridge webhook --provider voipms \\
      --payload '{"from":"+14187207735","message":"Salut","id":"abc"}' \\
      --agent pdf_bon_travail --runner hermes

  # Server with all features
  overmind-bridge server --port 3100 --webhooks --sanitize-json

ENV VARS
  BRIDGE_URL              Default server URL
  BRIDGE_AUTH_TOKEN       Default auth token
  MCP_URL                 Overmind MCP URL (default: http://localhost:3099/mcp)
  POSTGRES_HOST           Postgres host
  POSTGRES_PORT           Postgres port (default: 5432)
  POSTGRES_USER           Postgres user
  POSTGRES_PASSWORD       Postgres password
  POSTGRES_DB             Postgres database

For more help on a specific command:
  overmind-bridge <command> --help
`);
}

// ─── Run ───────────────────────────────────────────────────────────────────

main().catch((err) => {
  console.error('💥 Fatal:', (err as Error).message);
  if (process.env.DEBUG) console.error((err as Error).stack);
  process.exit(1);
});
