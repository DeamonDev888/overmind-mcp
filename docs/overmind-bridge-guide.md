# 🌉 Overmind Bridge — Agents Persistants & A2A (Guide Unifié)

> **Version**: Overmind v3.5.2 — Pattern générique, 2 à 100 agents
> **Date**: 2026-07-10
> **Statut**: Remplace `overmind-bridge-persistent-agents.md`, `overmind-bridge-commands-reference.md`, `doc_guide_agent_hermes_permanent.md`, `guide_agent_hermes_overmind.md`, `agent-http-tutorial.md`

---

## 1. Concepts

### Qu'est-ce qu'un agent persistant ?

Un agent persistant = **un process `overmind-bridge` autonome** qui :
- Écoute sur son propre port HTTP
- A son propre agent Hermes dédié (profil)
- Garde sa session entre les appels (mémoire conversationnelle)
- Communique avec les autres agents via HTTP A2A (peer-to-peer)
- Forward les appels LLM vers le MCP Overmind → Hermes Gateway

### Pourquoi des bridges isolés ?

| Sans bridge | Avec bridge isolé |
|-------------|-------------------|
| `spawn('hermes', ['-p', agent])` à chaque call | Process persistant, session conservée |
| 5-10s startup Python par call | <500ms (HTTP direct au Gateway) |
| Pas de communication inter-agent | A2A HTTP peer-to-peer |
| Crash d'un agent = crash global | Crash d'un agent ≠ impact sur les autres |
| Pas de monitoring par agent | `GET /health` par agent |

### L'échelle : 2 à 100 agents

Le pattern est **identique** que tu aies 2 ou 100 agents. Chaque agent = :
- 1 profil Hermes (`~/.hermes/profiles/<name>/`)
- 1 process bridge (`node dist/bridges/<name>/src/bridge.js`)
- 1 port dédié (séquence : 3101, 3102, ..., 31XX)

---

## 2. Architecture

```
┌──────────────────────────────────────────────────────────────┐
│              N BRIDGES ISOLÉS — PEER-TO-PEER                  │
│                                                              │
│  :3101  agent_alpha     → RPC locaux + A2A vers peers        │
│  :3102  agent_beta      → RPC locaux + A2A vers peers        │
│  :3103  agent_gamma     → RPC locaux + A2A vers peers        │
│  ...                                                         │
│  :31XX  agent_omega     → RPC locaux + A2A vers peers        │
│                                                              │
│  A2A = HTTP POST inter-bridges (JSON-RPC 2.0)                │
│  Chaque bridge a ses propres clients vers les autres         │
│                                                              │
│  SERVICES PARTAGÉS (single instance):                        │
│  :3099  Overmind MCP Server (routing run_agent, memory, ...) │
│  :8642  Hermes Gateway API (X-Hermes-Profile routing)        │
│  :5432  PostgreSQL (MessageLog + pgvector Memory)            │
└──────────────────────────────────────────────────────────────┘
```

### Ce que ce n'est PAS

- ❌ Un seul `OverBridgeServer` partagé qui dispatche vers N agents
- ❌ Un bridge "central" qui connaît tous les agents
- ❌ N instances Hermes Gateway (1 seule suffit, le header `X-Hermes-Profile` route)

### Services partagés (NE PAS dupliquer)

| Service | Port | URL | Rôle |
|---------|------|-----|------|
| **Overmind MCP** | :3099 | `http://[::1]:3099/mcp` | 14 tools : run_agent, a2a_hub, agent_control, memory_*, create_agent |
| **Hermes Gateway** | :8642 | `http://127.0.0.1:8642` | API Server HTTP+SSE, OpenAI-compatible, profile routing |
| **PostgreSQL** | :5432 | `localhost` | MessageLog (`bridge_messages`) + Memory (pgvector) |

### Allocation des ports

Les ports suivent une séquence simple : **3101 + offset**.

| Agent # | Port | Exemple nom |
|---------|------|-------------|
| #1 | 3101 | `agent_alpha` |
| #2 | 3102 | `agent_beta` |
| #3 | 3103 | `agent_gamma` |
| ... | ... | ... |
| #N | 3100+N | `agent_<name>` |

---

## 3. Créer un Agent Persistant

### Étape 1 : Créer le profil Hermes

```python
# Via MCP tool (recommandé)
create_agent(
    name: "agent_alpha",
    runner: "hermes",
    prompt: "Tu es l'agent Alpha. Tes missions: ...",
    model: "glm-5.2"
)
```

Ou via CLI :
```bash
hermes profile create agent_alpha --no-alias --description "Agent Alpha"
hermes -p agent_alpha config set model.provider z-ai
hermes -p agent_alpha config set model.model glm-5.2
```

### Structure créée sur disque

```
~/.hermes/profiles/agent_alpha/
├── config.yaml          # provider, model, mcp_servers
├── .env                 # clés API (GLM_API_KEY, MINIMAX_CN_API_KEY, ...)
├── SOUL.md              # system prompt + instructions mémoire
├── profile.yaml         # metadata kanban routing
├── workspace.yaml       # kind: persistent, gc_eligible: false
├── memories/            # state.db (mémoire SQLite isolée)
├── sessions/            # historique conversations
└── skills/              # mémoire procédurale
```

### Auto-détection du provider

| Modèle contient | Provider | Clé API |
|-----------------|----------|---------|
| `minimax`, `m3` | `minimax-cn` | `MINIMAX_CN_API_KEY` |
| `glm`, `zai` | `z-ai` | `GLM_API_KEY` |
| `claude`, `sonnet` | `anthropic` | `ANTHROPIC_API_KEY` |
| `gpt` | `openai` | `OPENAI_API_KEY` |
| `deepseek` | `deepseek` | `DEEPSEEK_API_KEY` |
| *(autre)* | `openrouter` | `OPENROUTER_API_KEY` |

### Étape 2 : Créer le bridge

```bash
# Créer la structure
mkdir -p bridges/agent_alpha/{src/clients,logs}
```

**`bridges/agent_alpha/.env`** :
```bash
AGENT_NAME=agent_alpha
RUNNER=hermes
BRIDGE_PORT=3101
BRIDGE_HOST=127.0.0.1
MCP_URL=http://[::1]:3099/mcp
HERMES_GATEWAY_URL=http://127.0.0.1:8642
HERMES_GATEWAY_KEY=<key>
SESSION_TTL_MS=14400000
MESSAGE_LOG_ENABLED=true
MCP_TIMEOUT_MS=120000

# Peers (autres bridges — vide si seul, ou liste tous les autres)
PEER_BETA_URL=http://127.0.0.1:3102
PEER_GAMMA_URL=http://127.0.0.1:3103
```

**`bridges/agent_alpha/src/config.ts`** :
```typescript
import { existsSync, readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { PeerMap } from '../../../common/src/types.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

function loadEnv(): Record<string, string> {
  const candidatePaths = [
    resolve(__dirname, '..', '.env'),
    resolve(__dirname, '..', '..', '..', '.env'),
  ];
  for (const p of candidatePaths) {
    if (existsSync(p)) return parseEnv(readFileSync(p, 'utf-8'));
  }
  throw new Error(`Missing .env. Looked in:\n  ${candidatePaths.join('\n  ')}`);
}

function parseEnv(raw: string): Record<string, string> {
  const env: Record<string, string> = {};
  for (const line of raw.split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const idx = t.indexOf('=');
    if (idx === -1) continue;
    env[t.slice(0, idx).trim()] = t.slice(idx + 1).trim().replace(/^["']|["']$/g, '');
  }
  return env;
}

const env = loadEnv();

export const config = {
  agentName: env.AGENT_NAME ?? 'agent_alpha',
  runner: env.RUNNER ?? 'hermes',
  port: parseInt(env.BRIDGE_PORT ?? '3101', 10),
  host: env.BRIDGE_HOST ?? '127.0.0.1',
  mcpUrl: env.MCP_URL ?? 'http://[::1]:3099/mcp',
  hermesGatewayUrl: env.HERMES_GATEWAY_URL ?? 'http://127.0.0.1:8642',
  gatewayKey: env.HERMES_GATEWAY_KEY ?? '',
  peers: {
    beta: env.PEER_BETA_URL,
    gamma: env.PEER_GAMMA_URL,
    // ... ajouter autant de peers que nécessaire
  } as PeerMap,
  sessionTtlMs: parseInt(env.SESSION_TTL_MS ?? '14400000', 10),
  messageLogEnabled: env.MESSAGE_LOG_ENABLED === 'true',
  mcpTimeoutMs: parseInt(env.MCP_TIMEOUT_MS ?? '120000', 10),
};
```

**`bridges/agent_alpha/src/bridge.ts`** :
```typescript
import { BaseBridge } from '../../../common/src/BaseBridge.js';
import { Logger } from '../../../common/src/logger.js';
import { config } from './config.js';

const logger = new Logger(config.agentName);

class AgentAlphaBridge extends BaseBridge {
  constructor() {
    super({
      agentName: config.agentName,
      port: config.port,
      host: config.host,
      mcpUrl: config.mcpUrl,
      gatewayUrl: config.hermesGatewayUrl,
      peers: config.peers,
      mcpTimeoutMs: config.mcpTimeoutMs,
      sessionTtlMs: config.sessionTtlMs,
      messageLogEnabled: config.messageLogEnabled,
    });

    // Enregistrer les méthodes RPC locales spécifiques à cet agent
    this.registerRpcMethod('alpha.execute', async (params) => {
      logger.info('Execute requested', params);
      return { status: 'done', ts: Date.now() };
    });
  }
}

const bridge = new AgentAlphaBridge();
bridge.start().catch((err) => {
  logger.error('Failed to start', { error: (err as Error).message });
  process.exit(1);
});

const shutdown = async (signal: string) => {
  logger.info(`Received ${signal} — shutting down`);
  await bridge.stop();
  process.exit(0);
};
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
```

### Étape 3 : Build et démarrage

```bash
# Build (depuis la racine du projet)
npm run build

# Démarrer ce bridge
node dist/bridges/agent_alpha/src/bridge.js

# Vérifier
curl http://127.0.0.1:3101/health
```

---

## 4. Module Common (partagé entre tous les bridges)

### `common/src/BaseBridge.ts`

Classe abstraite — chaque bridge l'étend. Fournit :
- Serveur HTTP (`POST /rpc`, `GET /health`, `POST /shutdown`)
- `registerRpcMethod(name, handler)` — méthodes RPC locales
- `forwardToMcp(request)` — forward vers MCP Overmind (`:3099/mcp`)
- SSE parsing (FastMCP répond en Server-Sent Events)
- Keep-alive HTTP agent (perf: connection reuse)
- Graceful shutdown (SIGINT/SIGTERM)

**Routage RPC interne** :
```
POST /rpc → dispatchRpc(method)
  1. health.ping → local (toujours)
  2. Méthode locale (registerRpcMethod) → handler local
  3. Sinon → forwardToMcp() → POST http://[::1]:3099/mcp
```

### `common/src/BridgeClient.ts`

Client HTTP pour appels inter-bridges (A2A). Fournit :
- `call(method, params)` — JSON-RPC 2.0 avec retry + backoff
- `healthCheck()` — GET /health sur un peer
- `sendToAgent(agentName, prompt)` — wrapper `agent.run`
- UUID uniques (pas de collision)
- Keep-alive agent partagé

```typescript
const client = new BridgeClient('http://127.0.0.1:3102');
const result = await client.call('beta.analyze', { symbol: 'BTC' });
```

### `common/src/types.ts`

Interfaces partagées : `BridgeConfig`, `PeerMap`, `HealthStatus`, `JsonRpcRequest/Response`, `RunnerType`.

### `common/src/logger.ts`

Logger zero-dep : console colorisée + fichier async (non bloquant), rotation 50MB, safe stringify (circular refs).

---

## 5. Commandes RPC (par bridge)

### Format de requête

```bash
curl -X POST http://127.0.0.1:<PORT>/rpc \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":"<id>","method":"<method>","params":{...}}'
```

### Endpoints communs (tous les bridges)

| Endpoint | HTTP | Description |
|----------|------|-------------|
| `GET /health` | GET | `{ agent, status, uptime, rpcMethods[], peerCount }` |
| `POST /rpc` | POST | JSON-RPC 2.0 dispatcher |
| `POST /shutdown` | POST | Arrêt propre |

### Méthodes RPC standards (tous les bridges)

| Méthode | Params | Description |
|---------|--------|-------------|
| `health.ping` | — | Ping local (toujours OK) |

### Méthodes RPC customs (spécifiques par agent)

Chaque agent enregistre ses propres méthodes via `registerRpcMethod()`. Exemple avec NEXUS :

#### Exemple : nexus_master (orchestrateur)

| Méthode | Params | Description |
|---------|--------|-------------|
| `master.status` | — | Agrège la santé de tous les peers |
| `master.broadcast` | `{ message }` | Fan-out à tous les peers |
| `master.pipeline` | `{ steps: [{ peer, prompt }] }` | Chaîne A→B→C |
| `master.fanout` | `{ peers[], prompt, merge? }` | Parallèle N + merge |

#### Exemple : nexus_trader

| Méthode | Params | Description |
|---------|--------|-------------|
| `trade.request` | `{ symbol, side, quantity }` | Valide via risk, notifie publisher |
| `trade.analysis` | `{ symbol, timeframe? }` | Délègue au researcher |

#### Exemple : nexus_risk_manager

| Méthode | Params | Description |
|---------|--------|-------------|
| `risk.validate` | `{ symbol, side, quantity }` | Valide un trade |
| `risk.drawdown` | — | Check drawdown |
| `risk.feedback` | `{ message, type }` | Feedback au trader |

#### Pattern pour créer tes propres méthodes

```typescript
// Dans ton bridge.ts
this.registerRpcMethod('myagent.dosomething', async (params) => {
  const p = params as { input: string };
  // Logique métier ici
  return { result: 'done', ts: Date.now() };
});
```

---

## 6. A2A — Communication Inter-Bridges

### A2A direct (bridge → bridge)

```typescript
// Dans un bridge, appeler un autre bridge
import { BridgeClient } from '../../../common/src/BridgeClient.js';

const peerClient = new BridgeClient('http://127.0.0.1:3102');
const result = await peerClient.call('trade.request', {
  symbol: 'BTC', side: 'BUY', quantity: 0.1,
});
```

### A2A via MCP Hub (tool `a2a_hub`)

Le MCP Overmind expose le tool `a2a_hub` avec 8 actions :

| Action | Params | Description |
|--------|--------|-------------|
| `discover` | — | Liste tous les agents + statut |
| `status` | `target` | État détaillé d'un agent |
| `send` | `target, message` | Message synchrone A→B |
| `delegate` | `target, message, callbackUrl?` | Async (retourne taskId) |
| `pipeline` | `message, steps[]` | Chaîne A→B→C |
| `fanout` | `targets[], message, mergeStrategy?` | 1→N + merge |
| `query` | `targets[], message` | Question multi-agents |
| `broadcast` | `message, race?` | Global à tous |

```python
a2a_hub(action="send", target="nexus_trader", message="Analyse BTC")
a2a_hub(action="fanout", targets=["agent_a","agent_b"], message="BTC?", mergeStrategy="best")
a2a_hub(action="pipeline", message="Analyse", steps=[{"agentName":"researcher"},{"agentName":"trader"}])
```

### A2A via OverBridgeServer (JSON-RPC 24 méthodes)

Le `OverBridgeServer` expose des méthodes A2A avancées avec persistence Postgres :

| Méthode | Description |
|---------|-------------|
| `agent.run` | Lance un agent (avec SessionStore multi-tenant) |
| `agent.a2a` | A→B avec header A2A standardisé |
| `agent.broadcast` | 1→N (race ou attend tous) |
| `agent.pipeline` | Chaîne A→B→C (accumulateContext?) |
| `agent.fanout` | 1→N + merge (concat/best/vote/first_success) |
| `agent.delegate` | Fire-and-forget + callback URL |
| `agent.query` | Multi-agent read-only rapide |
| `agent.status` | Status live (busy/idle/online) |
| `agent.list` | Liste filtrée |
| `agent.kill` | Kill un agent |
| `message.history` | Historique paginé (Postgres) |
| `message.get` | Récupère un message par UUID |
| `message.replay` | Rejoue un message |
| `message.stats` | Stats globales |
| `session.get` | Session par externalKey + agentName |
| `session.list` | Toutes les sessions |
| `session.delete` | Supprime une session |
| `session.stats` | Stats sessions |
| `webhook.sms` | Adapt + auto-dispatch SMS |
| `health.ping` | Liveness |

---

## 7. Lancer un Agent

### Via Gateway HTTP (recommandé — zero subprocess)

```python
run_agent(runner: "hermes", agentName: "agent_alpha", prompt: "Analyse le marché")
```

Sous le capot : `HermesGatewayRunner` → `POST :8642/v1/chat/completions` avec `X-Hermes-Profile: agent_alpha` + SSE streaming. Pas de spawn CLI.

### Via curl direct sur le Gateway

```bash
curl -X POST http://127.0.0.1:8642/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer ${API_SERVER_KEY}" \
  -H "X-Hermes-Profile: agent_alpha" \
  -d '{"model":"glm-5.2","messages":[{"role":"user","content":"Analyse le BTC"}],"stream":true}'
```

### Via bridge RPC

```bash
curl -X POST http://127.0.0.1:3101/rpc \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":"1","method":"agent.run","params":{"agentName":"agent_alpha","runner":"hermes","prompt":"Analyse le BTC"}}'
```

### Via Hermes CLI

```bash
hermes -p agent_alpha chat -q "Analyse le BTC" -Q --yolo
```

---

## 8. Gestion du Cycle de Vie

### Profils Hermes

| Action | Commande |
|--------|----------|
| Lister | `hermes profile list` |
| Voir | `hermes profile show agent_alpha` |
| Supprimer | `hermes profile delete agent_alpha --yes` |
| Changer modèle | `hermes -p agent_alpha config set model.model "MiniMax-M3"` |
| Update via Overmind | `update_agent_config(name: "agent_alpha", model: "new-model")` |

### Runtime

| Action | Commande |
|--------|----------|
| Status | `agent_control(agentName: "agent_alpha", action: "status")` |
| Stream output | `agent_control(agentName: "agent_alpha", action: "stream")` |
| Kill | `agent_control(agentName: "agent_alpha", action: "kill")` |
| Health bridge | `curl http://127.0.0.1:3101/health` |
| Shutdown bridge | `curl -X POST http://127.0.0.1:3101/shutdown` |

---

## 9. Scripts Helper

### Démarrage N bridges

```bash
# Start all (NEXUS example with 6)
node scripts/start-all-bridges.cjs

# Stop all
node scripts/stop-all-bridges.cjs

# Status
node scripts/status-bridges.cjs

# Test A2A network
node scripts/test-a2a.cjs
```

### Seed (créer la structure pour N agents)

```bash
node scripts/seed-bridges.cjs
# Crée bridges/<name>/{src/clients,logs} + .env pour chaque agent
```

### Build

```bash
# Build complet (tsc + postbuild copie .env et config)
npm run build

# Le postbuild copie automatiquement:
#   config/*.json → dist/config/
#   bridges/*/.env → dist/bridges/*/.env
```

### Activation Hermes Gateway

```bash
# Dans config.yaml
gateway:
  platforms:
    api_server:
      enabled: true

# Dans .env
API_SERVER_KEY=<key>
API_SERVER_ENABLED=1

# Redémarrer
hermes gateway restart
```

---

## 10. Ce que l'Agent Hérite Automatiquement

| Héritage | Source |
|----------|--------|
| **Mémoire isolée** | `state.db` SQLite dans `memories/` — `OVERMIND_AGENT_NAME` injecté |
| **Instructions mémoire** | Bloc "## Mémoire Overmind" injecté dans `SOUL.md` |
| **MCP servers** | `memory` (3 tools: search/store/runs) par défaut |
| **Clés API** | Toutes les clés du `.env` parent forwardées (GLM, MiniMax, OpenAI, ...) |
| **Sessions persistantes** | `sessions/` garde l'historique, `workspace.yaml: persistent` |
| **Kanban routing** | `profile.yaml` pour découverte par `a2a_hub` |
| **Gateway HTTP** | `HermesGatewayRunner` → `POST :8642` avec `X-Hermes-Profile` |
| **Circuit breaker** | `BridgeProxy` : 5 failures → open, 30s → half-open, 3 success → closed |
| **Retry automatique** | `ETIMEDOUT`, `EBODYREAD`, `ECONNRESET` → retry avec backoff |

---

## 11. Bugs Source Corrigés (2026-07-10)

### Overmind (`Workflow/src/bridge/`)

| Bug | Fichier | Fix |
|-----|---------|-----|
| `localhost` au lieu de `[::1]` (IPv4/IPv6 mismatch) | `types.ts` | → `http://[::1]:3099/mcp` |
| `ping()` sans SSE Accept (FastMCP rejette) | `BridgeProxy.ts` | → `Accept: text/event-stream` + fallback `GET /health` |
| `parseSseText` non importé | `BridgeProxy.ts` | → Import ajouté |

### NEXUS (`Nexus/common/` + `bridges/`)

| Bug | Fichier | Fix |
|-----|---------|-----|
| MCP URL `/rpc` au lieu de `/mcp` (404) | `BaseBridge.ts` | → `/mcp` + SSE parsing |
| Timeout MCP hardcodé 60s | `BaseBridge.ts` | → `config.mcpTimeoutMs` (120s) |
| `Date.now()` ID collision | `BridgeClient.ts` | → `crypto.randomUUID()` |
| `appendFileSync` (sync I/O) | `logger.ts` | → `appendFile` async + rotation 50MB |
| RPC custom forwardée au MCP (404) | `BaseBridge.ts` | → `registerRpcMethod()` dispatch local |
| `.env` introuvable après build | `config.ts` | → `candidatePaths[]` multi-niveaux |
| `postbuild` ne copiait pas `.env` | `postbuild.cjs` | → Section 2: copy bridges/.env |
| `*/` dans JSDoc cassait CJS | `postbuild.cjs` | → Comment reworded |
| Pas de graceful shutdown | `bridge.ts` ×N | → `process.on('SIGINT'/'SIGTERM')` |
| Pas de keep-alive HTTP | `BridgeClient.ts` | → `HttpAgent({ keepAlive: true })` |

### discord_llm

| Bug | Fichier | Fix |
|-----|---------|-----|
| `localhost:3099` au lieu de `[::1]` | `overmind-bridge.ts` | → `http://[::1]:3099/mcp` |
| `no-useless-assignment` lint | `overmind-bridge.ts` | → `let mcpStatus: string` |

---

## 12. Exemple Complet — 3 Agents qui Communiquent

### Créer 3 agents

```python
create_agent(name: "coordinator", runner: "hermes", prompt: "Tu coordonnes...", model: "glm-5.2")
create_agent(name: "worker_a", runner: "hermes", prompt: "Tu exécutes...", model: "glm-5.2")
create_agent(name: "worker_b", runner: "hermes", prompt: "Tu valides...", model: "glm-5.2")
```

### Structure

```
bridges/
├── coordinator/     # :3101
│   ├── .env         # PEER_WORKER_A_URL=http://127.0.0.1:3102
│   │                # PEER_WORKER_B_URL=http://127.0.0.1:3103
│   ├── src/bridge.ts  # registerRpcMethod('coord.dispatch', ...)
│   └── src/clients/CoordinatorToWorkerA.ts
│
├── worker_a/        # :3102
│   ├── .env         # PEER_COORDINATOR_URL=http://127.0.0.1:3101
│   └── src/bridge.ts  # registerRpcMethod('worker.execute', ...)
│
└── worker_b/        # :3103
    ├── .env         # PEER_COORDINATOR_URL=http://127.0.0.1:3101
    └── src/bridge.ts  # registerRpcMethod('worker.validate', ...)
```

### Communication

```bash
# Coordinator → Worker A (via bridge HTTP)
curl -X POST http://127.0.0.1:3101/rpc \
  -d '{"jsonrpc":"2.0","id":"1","method":"coord.dispatch","params":{"task":"analyze BTC"}}'

# Worker A → Worker B (via BridgeClient dans le code)
const client = new BridgeClient('http://127.0.0.1:3103');
await client.call('worker.validate', { result: 'BTC bullish' });

# Coordinator → tous (broadcast)
curl -X POST http://127.0.0.1:3101/rpc \
  -d '{"jsonrpc":"2.0","id":"2","method":"master.broadcast","params":{"message":"Standby"}}'
```

### Démarrage

```bash
node scripts/start-all-bridges.cjs  # Lance les 3 en parallèle
curl http://127.0.0.1:3101/health    # Verify coordinator
curl http://127.0.0.1:3102/health    # Verify worker_a
curl http://127.0.0.1:3103/health    # Verify worker_b
```

Le pattern est **identique** pour 2, 6, 10, ou 100 agents. Ajoute un bridge, un port, un .env, et il communique avec les autres via HTTP.