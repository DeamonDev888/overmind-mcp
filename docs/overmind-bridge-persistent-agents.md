# 🌉 Overmind Bridge — Agents Persistants & A2A

> **Version**: Overmind v3.5.0 — `src/bridge/` (1928 lignes OverBridgeServer + 443 OverBridgeService + 259 AgentRegistry)
> **Date**: 2026-07-09
> **Source**: `src/bridge/OverBridgeServer.ts`, `src/bridge/OverBridgeService.ts`, `src/bridge/AgentRegistry.ts`, `src/bin/overmind-bridge.ts`, `discord_llm/src/overmind-bridge.ts`

---

## Table des Matières

1. [Vue d'Ensemble](#vue-densemble)
2. [Architecture du Bridge](#architecture-du-bridge)
3. [Les 3 Couches de Persistance](#les-3-couches-de-persistance)
4. [AgentRegistry — État Live en Mémoire](#agentregistry--état-live-en-mémoire)
5. [SessionStore — Sessions Multi-Tenant](#sessionstore--sessions-multi-tenant)
6. [MessageLog — Persistence Postgres](#messagelog--persistence-postgres)
7. [JSON-RPC 2.0 — Toutes les Méthodes](#json-rpc-20--toutes-les-méthodes)
8. [A2A — Agent-to-Agent](#a2a--agent-to-agent)
9. [A2A Extended — Broadcast, Pipeline, Fanout, Delegate, Query](#a2a-extended--broadcast-pipeline-fanout-delegate-query)
10. [Comment Construire un Agent Persistant (comme discord_llm)](#comment-construire-un-agent-persistant-comme-discord_llm)
11. [CLI overmind-bridge](#cli-overmind-bridge)
12. [Démarrer le Serveur Bridge](#démarrer-le-serveur-bridge)

---

## Vue d'Ensemble

L'Overmind Bridge est un **serveur HTTP JSON-RPC 2.0** qui transforme les appels MCP one-shot en conversations persistantes et multi-tenant. C'est la couche qui rend les agents "always-on" — même entre deux requêtes Discord, l'état de l'agent (session, contexte, mémoire) est préservé.

### Le Problème Résolu

```
Sans Bridge:
  Discord !sniper → spawn hermes CLI → répond → meurt
  Discord !sniper → spawn hermes CLI → répond → meurt  (perte de contexte!)

Avec Bridge:
  Discord !sniper → POST /rpc agent.run → agent (session persistée)
  Discord !sniper → POST /rpc agent.run → agent (MÊME session, contexte conservé!)
```

---

## Architecture du Bridge

```
┌──────────────────────────────────────────────────────────────────┐
│                     CLIENTS (Discord, curl, Python)               │
│                                                                   │
│  discord_llm/overmind-bridge.ts    overmind-bridge CLI            │
│  (Express, port 3001)              (call, scenario, status)       │
└──────────────────────┬───────────────────────┬───────────────────┘
                       │ POST /rpc              │
                       │ JSON-RPC 2.0           │
                       ▼                        ▼
┌──────────────────────────────────────────────────────────────────┐
│               OverBridgeServer (port 3100)                        │
│               src/bridge/OverBridgeServer.ts                      │
│                                                                   │
│  ┌─────────────────────────────────────────────────────────────┐ │
│  │  dispatchRpc() — route les méthodes JSON-RPC                │ │
│  │  agent.run | agent.a2a | agent.broadcast | agent.pipeline   │ │
│  │  agent.fanout | agent.delegate | agent.query                │ │
│  │  agent.status | agent.list | agent.kill                     │ │
│  │  message.history | message.get | message.replay | stats     │ │
│  │  session.get | session.list | session.delete | session.stats│ │
│  │  webhook.sms | health.ping                                  │ │
│  └─────────────────────────────────────────────────────────────┘ │
│                                                                   │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────────────────┐ │
│  │ AgentRegistry│  │ SessionStore │  │ MessageLog (Postgres)    │ │
│  │ (in-memory)  │  │ (JSON file)  │  │ (bridge_messages table)  │ │
│  │ busy/idle    │  │ externalKey  │  │ from/to/prompt/response  │ │
│  │ mutex/agent  │  │ → sessionId  │  │ status: pending→done     │ │
│  └──────────────┘  └──────────────┘  └──────────────────────────┘ │
│                                                                   │
│  ┌─────────────────────────────────────────────────────────────┐ │
│  │ OverBridgeService (SDK wrapper)                             │ │
│  │ → BridgeProxy → HTTP POST http://[::1]:3099/mcp             │ │
│  │ → Overmind MCP Server → HermesGatewayRunner → Gateway :8642 │ │
│  └─────────────────────────────────────────────────────────────┘ │
└──────────────────────────────────────────────────────────────────┘
```

---

## Les 3 Couches de Persistance

| Couche | Stockage | TTL | Rôle |
|--------|----------|-----|------|
| **AgentRegistry** | In-memory (Map) | Session live | Mutex par agent (1 run à la fois), statut busy/idle/online |
| **SessionStore** | JSON file (`~/.overmind/bridge/sessions.json`) | 4h | Map `externalKey` → `sessionId` (multi-tenant: 1 session par utilisateur Discord) |
| **MessageLog** | PostgreSQL (`bridge_messages` table) | Permanent | Historique complet: from, to, prompt, response, status, timestamps |

---

## AgentRegistry — État Live en Mémoire

**Source**: `src/bridge/AgentRegistry.ts`

Tracke l'état live de chaque agent avec un **mutex par agent** pour sérialiser les appels concurrents :

```typescript
interface AgentLiveState {
  name: string;
  runner: RunnerType;
  status: 'online' | 'offline' | 'busy' | 'idle';
  pid?: number;
  currentSessionId?: string;      // Session en cours (si busy)
  lastActivityAt: number;
  totalRuns: number;
  totalErrors: number;
  a2aReceived: number;             // Compteur A2A reçu
  a2aSent: number;                 // Compteur A2A envoyé
}
```

### Mutex — 1 Run à la Fois par Agent

```typescript
// Si agent "trader_btc" est déjà en train de tourner,
// le 2e appel attend que le 1er termine.
await this.registry.withLock('trader_btc', async () => {
  this.registry.markBusy('trader_btc', sessionId);
  const result = await this.service.runAgent({ ... });
  this.registry.markIdle('trader_btc', !result.isError);
  return result;
});
```

### Méthodes Disponibles

| Méthode | Description |
|---------|-------------|
| `register(name, runner)` | Enregistre l'agent dans le registry |
| `markBusy(name, sessionId)` | Marque comme occupé (run en cours) |
| `markIdle(name, success)` | Marque comme libre + incrémente compteurs |
| `markOnline(name)` | Marque comme en ligne |
| `markOffline(name)` | Marque comme hors ligne |
| `get(name)` | Retourne l'état live complet |
| `list({ status, runner })` | Liste filtrée des agents |
| `stats()` | Stats globales (total, busy, idle, online) |
| `incrementA2aSent(name)` | Incrémente le compteur A2A envoyé |
| `incrementA2aReceived(name)` | Incrémente le compteur A2A reçu |
| `prune(maxAgeMs)` | Nettoie les agents offline > 24h (auto toutes les 6h) |

---

## SessionStore — Sessions Multi-Tenant

**Source**: `src/bridge/SessionStore.ts`

Le **multi-tenant** : chaque utilisateur externe a sa propre session persistante avec l'agent.

### Comment ça Marche

```
Utilisateur Discord A (!sniper analyse BTC)
  → externalKey = "discord_user_123"
  → SessionStore.get("discord_user_123", "sniperbot_analyst")
  → sessionId = "abc-123"  (session restaurée!)
  → runAgent avec sessionId="abc-123"
  → SessionStore.set("discord_user_123", "sniperbot_analyst", "abc-123")

Utilisateur Discord B (!sniper analyse ETH)
  → externalKey = "discord_user_456"
  → SessionStore.get("discord_user_456", "sniperbot_analyst")
  → pas de session → nouvelle session
  → sessionId = "def-456"
```

### Persistence

```json
// ~/.overmind/bridge/sessions.json
{
  "discord_user_123:sniperbot_analyst": {
    "externalKey": "discord_user_123",
    "agentName": "sniperbot_analyst",
    "runner": "hermes",
    "sessionId": "abc-123",
    "context": { "lastTopic": "BTC", "language": "fr" },
    "createdAt": "2026-07-09T18:00:00Z",
    "updatedAt": "2026-07-09T18:05:00Z"
  }
}
```

### TTL et Cleanup

- TTL par défaut: **4h** (`sessionTtlMs: 4 * 60 * 60 * 1000`)
- Cleanup automatique toutes les **5min** (`cleanupIntervalMs`)
- Sessions expirées → supprimées du fichier

### Directives — L'Agent Peut Mettre à Jour Sa Session

Quand `enableDirectives: true`, l'agent peut émettre des directives dans sa réponse :

```
SESSION_ID: new-session-xyz     → met à jour le sessionId
CONTEXT_UPDATE: {"lastTopic": "ETH"}  → patch le contexte
BRIDGE_HINT: "Analyse terminée"  → log seulement
```

Le `DirectiveParser` (`src/bridge/DirectiveParser.ts`) parse ces directives, les applique au SessionStore, et les retire du texte visible par l'utilisateur.

---

## MessageLog — Persistence Postgres

**Source**: `src/bridge/MessageLog.ts`

Historique permanent de tous les messages A2A et agent.run dans PostgreSQL.

### Schéma de Table

```sql
CREATE TABLE bridge_messages (
  id          UUID PRIMARY KEY,
  from_agent  VARCHAR(255),        -- NULL si client externe
  to_agent    VARCHAR(255) NOT NULL,
  runner      VARCHAR(50) NOT NULL,
  prompt      TEXT NOT NULL,
  response    TEXT,
  session_id  VARCHAR(255),
  status      VARCHAR(20) DEFAULT 'pending',  -- pending → running → done/failed/timeout
  metadata    JSONB,
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  updated_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_bridge_messages_to_agent   ON bridge_messages(to_agent, created_at DESC);
CREATE INDEX idx_bridge_messages_from_agent ON bridge_messages(from_agent, created_at DESC);
CREATE INDEX idx_bridge_messages_status     ON bridge_messages(status);
```

### Cycle de Vie d'un Message

```
agent.run appelé
  → messageLog.create()     → status: "pending"
  → messageLog.markRunning() → status: "running"
  → agent termine...
     → succès: messageLog.markDone()    → status: "done", response sauvegardée
     → erreur:  messageLog.markFailed()  → status: "failed", error sauvegardé
     → timeout: messageLog.markTimeout() → status: "timeout"
```

### Replay

```bash
# Rejouer un message (re-run avec le même prompt)
curl -X POST http://localhost:3100/rpc \
  -d '{"jsonrpc":"2.0","id":1,"method":"message.replay","params":{"id":"7f3e8a1b-..."}}'
```

---

## JSON-RPC 2.0 — Toutes les Méthodes

### Endpoint

```
POST /rpc
Content-Type: application/json
Authorization: Bearer <token>   (optionnel si authToken configuré)

# Single request
{"jsonrpc":"2.0","id":1,"method":"agent.run","params":{...}}

# Batch (parallèle)
[
  {"jsonrpc":"2.0","id":1,"method":"agent.run","params":{...}},
  {"jsonrpc":"2.0","id":2,"method":"agent.list","params":{}}
]
```

### Méthodes Disponibles (24 méthodes)

#### Agents (10 méthodes)

| Méthode | Params Requis | Params Optionnels | Description |
|---------|---------------|-------------------|-------------|
| `agent.run` | `agentName`, `runner`, `prompt` | `sessionId`, `path`, `model`, `mode`, `silent`, `externalKey`, `parseDirectives`, `metadata` | Lance un agent |
| `agent.a2a` | `fromAgent`, `toAgent`, `runner`, `prompt` | `model`, `path`, `metadata` | Agent A parle à Agent B |
| `agent.broadcast` | `fromAgent`, `runner`, `prompt` | `targets[]`, `race`, `agentTimeoutMs`, `model` | Fan-out global |
| `agent.pipeline` | `initiator`, `runner`, `prompt`, `steps[]` | `accumulateContext`, `totalTimeoutMs` | Chaîne A→B→C |
| `agent.fanout` | `fromAgent`, `runner`, `prompt`, `targets[]` | `mergeStrategy`, `agentTimeoutMs`, `model` | 1→N + merge |
| `agent.delegate` | `fromAgent`, `toAgent`, `runner`, `prompt` | `async`, `callbackUrl`, `model` | Fire-and-forget |
| `agent.query` | `fromAgent`, `runner`, `prompt`, `targets[]` | `agentTimeoutMs`, `model` | Query multi-agents |
| `agent.status` | `agentName` | `runner`, `action`, `sinceTimestamp`, `timeoutMs` | Status live |
| `agent.list` | — | `status`, `runner` | Liste des agents |
| `agent.kill` | `agentName` | `runner` | Kill un agent |

#### Messages (4 méthodes)

| Méthode | Params | Description |
|---------|--------|-------------|
| `message.history` | `toAgent?`, `fromAgent?`, `status?`, `limit?`, `offset?`, `sinceHours?` | Historique paginé |
| `message.get` | `id` (UUID) | Récupère un message |
| `message.replay` | `id` (UUID) | Rejoue un message |
| `message.stats` | — | Stats globales |

#### Sessions (4 méthodes)

| Méthode | Params | Description |
|---------|--------|-------------|
| `session.get` | `externalKey`, `agentName` | Session d'un utilisateur |
| `session.list` | — | Toutes les sessions |
| `session.delete` | `externalKey`, `agentName` | Supprime une session |
| `session.stats` | — | Stats des sessions |

#### Autres (6 méthodes)

| Méthode | Description |
|---------|-------------|
| `health.ping` | Liveness check |
| `webhook.sms` | Adapt + auto-dispatch webhook SMS |
| `GET /health` | Healthcheck enrichi (hors RPC) |
| `POST /webhook/:provider` | Webhook HTTP (voipms, twilio, discord) |
| `GET /f/:filename` | Static file serve |
| `OPTIONS *` | CORS preflight |

---

## A2A — Agent-to-Agent

### Principe

Agent A envoie un message à Agent B. Le bridge :
1. Enrichit le prompt avec un header A2A standardisé
2. Persiste le message dans MessageLog (from=A, to=B)
3. Incrémente les compteurs A2A (sent pour A, received pour B)
4. Exécute B sous mutex (sérialise les appels concurrents vers B)
5. Retourne la réponse de B à A

### Format du Prompt A2A

```
[A2A — Agent-to-Agent Message]
FROM: trader_btc
TO: analyst_eth
TIMESTAMP: 2026-07-09T18:30:00.000Z
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Valide mon analyse : le BTC va casser les 100k dans 48h
```

### Exemple curl

```bash
curl -X POST http://localhost:3100/rpc \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc": "2.0",
    "id": 1,
    "method": "agent.a2a",
    "params": {
      "fromAgent": "trader_btc",
      "toAgent": "analyst_eth",
      "runner": "hermes",
      "prompt": "Valide mon analyse : le BTC va casser les 100k dans 48h"
    }
  }'
```

### Réponse

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "result": {
    "messageId": "7f3e8a1b-...",
    "from": "trader_btc",
    "to": "analyst_eth",
    "sessionId": "api-abc123",
    "content": [{ "type": "text", "text": "Je valide avec conviction 75..." }],
    "isError": false
  }
}
```

---

## A2A Extended — Broadcast, Pipeline, Fanout, Delegate, Query

### 1. Broadcast — 1 → Tous (Fan-out Global)

Un agent envoie un message à tous les agents online (ou à une liste cible).

```bash
curl -X POST http://localhost:3100/rpc \
  -d '{
    "jsonrpc": "2.0", "id": 1,
    "method": "agent.broadcast",
    "params": {
      "fromAgent": "commander",
      "runner": "hermes",
      "prompt": "Alerte marché : BTC drop 5%",
      "race": false,
      "agentTimeoutMs": 60000
    }
  }'
```

- `race: true` → retourne dès qu'un agent répond (premier qui gagne)
- `race: false` → attend tous les agents
- Si `targets` absent → tous les agents `online` (excluant l'émetteur)

### 2. Pipeline — Chaîne Séquentielle A→B→C

L'output de chaque step devient l'input du suivant.

```bash
curl -X POST http://localhost:3100/rpc \
  -d '{
    "jsonrpc": "2.0", "id": 1,
    "method": "agent.pipeline",
    "params": {
      "initiator": "commander",
      "runner": "hermes",
      "prompt": "Analyse le marché BTC actuel",
      "steps": [
        { "agentName": "data_collector", "promptPrefix": "Récupère les données:" },
        { "agentName": "analyst", "promptPrefix": "Analyse ces données:" },
        { "agentName": "strategist", "promptPrefix": "Propose une stratégie:" }
      ],
      "accumulateContext": true,
      "totalTimeoutMs": 3600000
    }
  }'
```

- `accumulateContext: true` → chaque step reçoit TOUS les outputs précédents
- `accumulateContext: false` → chaque step ne reçoit que le dernier output
- Timeout global avec deadline check à chaque step

### 3. Fanout — 1 → N Parallèle + Merge

Un agent demande à plusieurs agents en parallèle, puis merge les résultats.

```bash
curl -X POST http://localhost:3100/rpc \
  -d '{
    "jsonrpc": "2.0", "id": 1,
    "method": "agent.fanout",
    "params": {
      "fromAgent": "commander",
      "runner": "hermes",
      "prompt": "Quelle stratégie pour le BTC?",
      "targets": ["analyst_1", "analyst_2", "analyst_3"],
      "mergeStrategy": "best"
    }
  }'
```

Stratégies de merge :

| Stratégie | Description |
|-----------|-------------|
| `concat` | Concatène toutes les réponses (défaut) |
| `best` | Sélectionne la plus longue réponse |
| `vote` | Vote par bucket de taille (100 chars) |
| `first_success` | Premier qui réussit |

### 4. Delegate — Fire-and-Forget Async

Délègue une tâche à un agent de façon asynchrone. Retourne immédiatement avec un `taskId`.

```bash
curl -X POST http://localhost:3100/rpc \
  -d '{
    "jsonrpc": "2.0", "id": 1,
    "method": "agent.delegate",
    "params": {
      "fromAgent": "commander",
      "toAgent": "researcher",
      "runner": "hermes",
      "prompt": "Recherche l'historique des crashes BTC 2024",
      "async": true,
      "callbackUrl": "https://myapp.com/webhook/agent-done"
    }
  }'
```

- `async: true` → retourne immédiatement avec `taskId`
- `callbackUrl` → POST le résultat quand l'agent termine
- L'agent peut être suivi via `agent.status(agentName: "researcher")`

### 5. Query — Multi-Agent Read-Only

Comme fanout mais optimisé pour des réponses courtes et rapides.

```bash
curl -X POST http://localhost:3100/rpc \
  -d '{
    "jsonrpc": "2.0", "id": 1,
    "method": "agent.query",
    "params": {
      "fromAgent": "commander",
      "runner": "hermes",
      "prompt": "Prix actuel du BTC?",
      "targets": ["price_bot_1", "price_bot_2"],
      "agentTimeoutMs": 30000
    }
  }'
```

---

## Comment Construire un Agent Persistant (comme discord_llm)

`discord_llm` est l'exemple canonique d'un client persistant du bridge. Voici le pattern complet :

### Architecture discord_llm

```
┌─────────────────────────────────────────────────────────┐
│  discord_llm/ (package: discord-claude-bridge v3.5.0)   │
│                                                          │
│  startpipeline.ts  → PipelineManager                     │
│    ├── spawn overmind-bridge.ts (Express :3001)          │
│    │   ├── OverBridgeService (SDK wrapper)               │
│    │   ├── BridgeProxy → HTTP [::1]:3099/mcp             │
│    │   ├── SessionStore (multi-tenant, JSON file)        │
│    │   └── WebhookAdapter (voipms, twilio, discord)      │
│    │                                                      │
│    └── spawn discord-bot.ts (Discord.js)                 │
│        ├── reçoit !sniper <message>                      │
│        └── POST localhost:3001/send                      │
│             → OverBridgeService.runAgentForDiscord()     │
│             → BridgeProxy → MCP :3099                    │
│             → HermesGatewayRunner → Gateway :8642        │
│             → réponse → Discord                          │
└─────────────────────────────────────────────────────────┘
```

### Étape 1 : Importer le SDK Overmind

```typescript
// Import depuis overmind-mcp (package npm ou file:../Workflow)
import {
  OverBridgeService,    // SDK haut niveau (runAgent, sessions, heartbeat)
  SessionStore,         // Multi-tenant (externalKey → sessionId)
  WebhookAdapter,       // Adaptation webhooks (SMS, Discord, Twilio)
  BridgeProxy,          // Low-level MCP transport (HTTP JSON-RPC)
} from 'overmind-mcp/bridge';
```

### Étape 2 : Configurer le Bridge

```typescript
const OVERMIND_MCP_URL = process.env.OVERMIND_MCP_URL || 'http://localhost:3099/mcp';
const AGENT_NAME = process.env.BRIDGE_AGENT || 'sniperbot_analyst';
const RUNNER = 'hermes';

// Low-level proxy → parle au MCP server
const proxy = new BridgeProxy({
  mcpUrl: OVERMIND_MCP_URL,
  defaultTimeoutMs: 60_000,
  agentTimeoutMs: 2_700_000,  // 45 min
  maxRetries: 2,
  retryDelayMs: 2_000,
}, undefined, logger);

// High-level service → session continuity + retry + circuit breaker
const service = new OverBridgeService({
  mcpUrl: OVERMIND_MCP_URL,
  defaultTimeoutMs: 60_000,
  agentTimeoutMs: 2_700_000,
  maxRetries: 2,
  retryDelayMs: 2_000,
}, logger);

// Multi-tenant sessions
const sessionStore = new SessionStore({
  persistPath: '~/.overmind/bridge/sessions.json',
  ttlMs: 4 * 60 * 60 * 1000,        // 4h
  cleanupIntervalMs: 5 * 60 * 1000,  // 5min
}, logger);

await sessionStore.init();
```

### Étape 3 : Exposer les Endpoints HTTP

```typescript
import express from 'express';
const app = express();
app.use(express.json({ limit: '10mb' }));

// ─── Route legacy (Discord bot) ─────────────────────────
app.post('/send', async (req, res) => {
  const { message, userId, username, channelId } = req.body;

  // Lance l'agent avec contexte Discord
  const result = await service.runAgentForDiscord(
    AGENT_NAME, RUNNER, message,
    { channelId, userId, username }
  );

  if (result.isError) {
    return res.status(500).json({ error: result.content.map(c => c.text).join('\n') });
  }

  res.json({
    result: result.content.map(c => c.text).join('\n'),
    session_id: result.sessionId || service.sessionId,
  });
});

// ─── JSON-RPC 2.0 endpoint ──────────────────────────────
app.post('/rpc', async (req, res) => {
  const { method, params, id } = req.body;

  switch (method) {
    case 'agent.run':
      // Résolution sessionId via SessionStore
      let sessionId = params.sessionId;
      if (!sessionId && params.externalKey) {
        const stored = sessionStore.get(params.externalKey, params.agentName);
        if (stored) sessionId = stored.sessionId;
      }

      const result = await service.runAgent({
        agentName: params.agentName,
        runner: params.runner,
        prompt: params.prompt,
        sessionId,
        model: params.model,
      });

      // Sauvegarde sessionId pour cet utilisateur
      if (params.externalKey && result.sessionId) {
        sessionStore.set({
          externalKey: params.externalKey,
          agentName: params.agentName,
          runner: params.runner,
          sessionId: result.sessionId,
        });
      }

      return res.json({ jsonrpc: '2.0', id, result: {
        sessionId: result.sessionId,
        content: result.content,
        isError: result.isError,
      }});

    case 'agent.a2a':
      const enrichedPrompt = [
        `[A2A — Agent-to-Agent Message]`,
        `FROM: ${params.fromAgent}`,
        `TO: ${params.toAgent}`,
        `TIMESTAMP: ${new Date().toISOString()}`,
        `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`,
        params.prompt,
      ].join('\n');

      const a2aResult = await service.runAgent({
        agentName: params.toAgent,
        runner: params.runner,
        prompt: enrichedPrompt,
        model: params.model,
      });

      return res.json({ jsonrpc: '2.0', id, result: {
        from: params.fromAgent,
        to: params.toAgent,
        sessionId: a2aResult.sessionId,
        content: a2aResult.content,
        isError: a2aResult.isError,
      }});

    case 'agent.list':
      const agents = await proxy.call('list_agents', { details: params.details });
      return res.json({ jsonrpc: '2.0', id, result: agents.result });

    case 'session.get':
      return res.json({ jsonrpc: '2.0', id, result: {
        session: sessionStore.get(params.externalKey, params.agentName) ?? null,
      }});

    case 'session.list':
      return res.json({ jsonrpc: '2.0', id, result: {
        sessions: sessionStore.list(),
        stats: sessionStore.stats(),
      }});

    case 'health.ping':
      return res.json({ jsonrpc: '2.0', id, result: { pong: true, ts: Date.now() }});
  }
});

// ─── Health ─────────────────────────────────────────────
app.get('/health', async (_req, res) => {
  let mcpStatus = 'unknown';
  try {
    const health = await proxy.healthCheck();
    mcpStatus = health.status;
  } catch { mcpStatus = 'offline'; }
  res.json({
    status: 'ok',
    version: '5.1.0',
    mcp: { url: OVERMIND_MCP_URL, status: mcpStatus },
    sessions: sessionStore.stats(),
  });
});

app.listen(3001, () => logger.info('Bridge on :3001'));
```

### Étape 4 : Démarrer le Pipeline

```typescript
// startpipeline.ts — orchestre bridge + bot
class PipelineManager {
  async start() {
    // 1. Démarrer le bridge (HTTP server)
    this.bridgeProcess = spawn('node', ['dist/overmind-bridge.js']);

    // 2. Attendre qu'il soit prêt
    await this.waitForBridge();  // GET /health jusqu'à 200

    // 3. Démarrer le bot Discord
    this.discordProcess = spawn('node', ['dist/discord-bot.js']);

    // 4. Auto-restart du bot si crash (max 3 tentatives)
    this.discordProcess.on('exit', (code) => {
      if (!this.isShuttingDown) this.restartDiscordBot();
    });
  }
}
```

### Étape 5 : Configurer le .env

```bash
# discord_llm/.env
CLAUDE_SERVER_PORT=3001                        # Port du bridge
RUNNER=hermes                                  # Runner Overmind
BRIDGE_AGENT=sniperbot_analyst                 # Agent par défaut
OVERMIND_MCP_URL=http://[::1]:3099/mcp         # MCP server
DISCORD_BOT_TOKEN=***                          # Token Discord
BOT_PREFIX=!sniper                             # Préfixe commandes
```

---

## CLI overmind-bridge

Le CLI `overmind-bridge` (`src/bin/overmind-bridge.ts`) permet de piloter le bridge sans écrire de code.

### Démarrer le serveur

```bash
overmind-bridge server --port 3100
```

### Appels one-shot (8 sources de prompt)

```bash
# 1. Flag direct
overmind-bridge call agent.run --agent scout --runner hermes --prompt "Analyse BTC"

# 2. Stdin
echo "Analyse BTC" | overmind-bridge call agent.run --agent scout --runner hermes --prompt-stdin

# 3. Fichier
overmind-bridge call agent.run --agent scout --runner hermes --prompt-file ./brief.txt

# 4. Fichier + variables
overmind-bridge call agent.run --agent scout --runner hermes \
  --prompt-file ./brief.txt --var ticker=BTC --var timeframe=4h

# 5-8. env-var, scenario, pipe, multi-file (voir --help)
```

### A2A via CLI

```bash
overmind-bridge call agent.a2a \
  --from scout --to analyst --runner hermes \
  --prompt "Valide mon analyse"
```

### Scénarios multi-agents

```bash
# JSON scenario file
overmind-bridge scenario ./workflow.json --var ticker=BTC
```

### Status et Health

```bash
# Status de tous les agents
overmind-bridge status

# Health du serveur
overmind-bridge health

# Replay un message
overmind-bridge replay --id 7f3e8a1b-...

# Sessions
overmind-bridge sessions list
overmind-bridge sessions get --key "+141****7735" --agent pdf_bon_travail
overmind-bridge sessions rm --key "+141****7735" --agent pdf_bon_travail
```

---

## Démarrer le Serveur Bridge

### Option A : OverBridgeServer natif (port 3100)

```typescript
import { OverBridgeServer, OverBridgeService, loadMessageLogConfigFromEnv } from 'overmind-mcp/bridge';

const service = new OverBridgeService({
  mcpUrl: 'http://[::1]:3099/mcp',
  defaultTimeoutMs: 60_000,
  agentTimeoutMs: 2_700_000,
}, logger);

const server = new OverBridgeServer(service, {
  port: 3100,
  host: '127.0.0.1',
  postgres: loadMessageLogConfigFromEnv(),
  enableMessageLog: true,       // Persistence Postgres
  enableSessionStore: true,     // Multi-tenant sessions
  enableDirectives: true,       // SESSION_ID, CONTEXT_UPDATE directives
  enableWebhooks: true,         // /webhook/:provider
  sessionTtlMs: 4 * 60 * 60 * 1000,  // 4h
  rateLimitMax: 100,            // 100 req/min par IP
  allowedOrigins: ['*'],
  sanitizeJson: true,           // Windows path repair
});

await server.start();
// POST http://127.0.0.1:3100/rpc  (JSON-RPC 2.0)
// GET  http://127.0.0.1:3100/health
// POST http://127.0.0.1:3100/webhook/:provider
```

### Option B : Bridge léger Express (comme discord_llm)

Pour un client qui n'a pas besoin de Postgres MessageLog mais veut les sessions multi-tenant :

```typescript
import express from 'express';
import { OverBridgeService, SessionStore, BridgeProxy } from 'overmind-mcp/bridge';

const app = express();
app.use(express.json());

const service = new OverBridgeService({ mcpUrl: 'http://[::1]:3099/mcp' });
const sessions = new SessionStore({ persistPath: './sessions.json' });
await sessions.init();

// POST /send, POST /rpc, GET /health...
app.listen(3001);
```

### Option C : CLI direct

```bash
# Démarrer le serveur OverBridgeServer complet
overmind-bridge server --port 3100 --enable-message-log --enable-sessions --enable-webhooks
```

---

## Configurations du OverBridgeServer

| Config | Default | Description |
|--------|---------|-------------|
| `port` | 3100 | Port HTTP |
| `host` | 127.0.0.1 | Host d'écoute |
| `postgres` | — | Config Postgres pour MessageLog |
| `enableMessageLog` | false | Persistence des messages en DB |
| `enableSessionStore` | false | Sessions multi-tenant |
| `enableDirectives` | false | Parse SESSION_ID, CONTEXT_UPDATE |
| `enableWebhooks` | false | Auto-mount /webhook/:provider |
| `authToken` | — | Bearer token auth |
| `healthCheckIntervalMs` | 30000 | Heartbeat vers MCP |
| `sessionTtlMs` | 14400000 (4h) | TTL sessions |
| `sessionStorePath` | ~/.overmind/bridge/sessions.json | Fichier persistence |
| `jsonBodyLimit` | 10mb | Limite body |
| `sanitizeJson` | false | Repair JSON Windows paths |
| `allowedOrigins` | localhost:3000,5173 | CORS |
| `rateLimitMax` | 100 | Max req/min par IP |
