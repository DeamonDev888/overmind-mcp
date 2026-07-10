# 📋 Référence Complète — Commandes A2A & RPC Overmind Bridge

> **Version**: Overmind v3.5.2 + NEXUS V17 (6 bridges isolés P2P)
> **Date**: 2026-07-10
> **Portée**: Code source Overmind + bridges NEXUS + discord_llm

---

## Table des Matières

1. [Architecture Corrigée](#architecture-corrigée)
2. [Services Partagés](#services-partagés)
3. [Commandes RPC par Bridge (NEXUS)](#commandes-rpc-par-bridge-nexus)
4. [Commandes RPC OverBridgeServer (Overmind)](#commandes-rpc-overbridgeserver-overmind)
5. [Commandes A2A Hub (MCP Tool)](#commandes-a2a-hub-mcp-tool)
6. [Commandes CLI overmind-bridge](#commandes-cli-overmind-bridge)
7. [Commandes Hermes Profile Management](#commandes-hermes-profile-management)
8. [Scripts Helper d'Installation](#scripts-helper-dinstallation)
9. [Bugs Source Corrigés](#bugs-source-corrigés)

---

## Architecture Corrigée

```
┌────────────────────────────────────────────────────────────────────┐
│                   6 BRIDGES ISOLÉS — P2P                            │
│                                                                    │
│  :3101  nexus_master       4 RPC: status/broadcast/pipeline/fanout │
│  :3102  nexus_trader       2 RPC: trade.request/trade.analysis     │
│  :3103  nexus_risk_manager 3 RPC: validate/drawdown/feedback       │
│  :3104  nexus_healer       3 RPC: fixed/failed/diagnose            │
│  :3105  nexus_researcher   2 RPC: query/summarize                  │
│  :3106  nexus_publisher    3 RPC: trade-open/trade-close/signal    │
│                                                                    │
│  TOTAL: 17 RPC methods                                             │
│                                                                    │
│  A2A = HTTP POST inter-bridges (chaque bridge a ses propres clients)│
│                                                                    │
│  SERVICES PARTAGÉS:                                                │
│  :3099  Overmind MCP Server (routing central)                      │
│  :8642  Hermes Gateway API (X-Hermes-Profile routing)              │
│  :5432  PostgreSQL (MessageLog + Memory)                           │
└────────────────────────────────────────────────────────────────────┘
```

---

## Services Partagés

| Service | Port | URL | Rôle |
|---------|------|-----|------|
| **Overmind MCP** | :3099 | `http://[::1]:3099/mcp` | 14 tools: run_agent, a2a_hub, agent_control, memory_*, create_agent, etc. |
| **Hermes Gateway** | :8642 | `http://127.0.0.1:8642` | API Server HTTP+SSE (OpenAI-compatible) |
| **PostgreSQL** | :5432 | `localhost` | MessageLog (bridge_messages) + Memory (pgvector) |
| **Hyperliquid MCP** | :3150 | `http://localhost:3150` | Trading data (NEXUS-specific, roadmap) |

---

## Commandes RPC par Bridge (NEXUS)

Chaque bridge expose `POST /rpc` (JSON-RPC 2.0) + `GET /health` + `POST /shutdown`.

### Format de Requête

```bash
curl -X POST http://127.0.0.1:<PORT>/rpc \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":"<id>","method":"<method>","params":{...}}'
```

### :3101 — nexus_master (Orchestrateur)

| Méthode | Params | Description |
|---------|--------|-------------|
| `health.ping` | — | Ping local (toujours OK) |
| `master.status` | — | Agrège la santé des 6 bridges en temps réel |
| `master.broadcast` | `{ message: string }` | Fan-out un prompt aux 5 peer bridges |
| `master.pipeline` | `{ steps: [{ peer, prompt }] }` | Chaîne séquentielle A→B→C entre bridges |
| `master.fanout` | `{ peers: string[], prompt, merge? }` | Parallèle N bridges + merge (concat/best/first_success) |

**Exemples:**

```bash
# Status réseau complet
curl -s -X POST http://127.0.0.1:3101/rpc \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":"1","method":"master.status"}'

# Broadcast à tous les peers
curl -s -X POST http://127.0.0.1:3101/rpc \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":"2","method":"master.broadcast","params":{"message":"Alerte marché"}}'

# Pipeline: researcher → trader → publisher
curl -s -X POST http://127.0.0.1:3101/rpc \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":"3","method":"master.pipeline","params":{"steps":[{"peer":"researcher","prompt":"Analyse BTC"},{"peer":"trader","prompt":"Décide trade"},{"peer":"publisher","prompt":"Publie signal"}]}}'

# Fanout parallèle + merge best
curl -s -X POST http://127.0.0.1:3101/rpc \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":"4","method":"master.fanout","params":{"peers":["researcher","trader"],"prompt":"BTC outlook","merge":"best"}}'
```

### :3102 — nexus_trader (Exécution + Analyse)

| Méthode | Params | Description |
|---------|--------|-------------|
| `trade.request` | `{ symbol, side, quantity, entryPrice?, stopLoss?, takeProfit? }` | Valide via risk, notifie publisher |
| `trade.analysis` | `{ symbol, timeframe? }` | Délègue au researcher |

```bash
curl -s -X POST http://127.0.0.1:3102/rpc \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":"1","method":"trade.request","params":{"symbol":"BTC","side":"BUY","quantity":0.1}}'
```

### :3103 — nexus_risk_manager (Validation + Drawdown)

| Méthode | Params | Description |
|---------|--------|-------------|
| `risk.validate` | `{ symbol, side, quantity, entryPrice?, stopLoss?, takeProfit? }` | Valide un trade proposé |
| `risk.drawdown` | — | Vérifie le drawdown actuel du portfolio |
| `risk.feedback` | `{ message, type, suggestedParams? }` | Feedback au trader |

```bash
curl -s -X POST http://127.0.0.1:3103/rpc \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":"1","method":"risk.validate","params":{"symbol":"BTC","side":"BUY","quantity":0.1}}'
```

### :3104 — nexus_healer (Auto-réparation)

| Méthode | Params | Description |
|---------|--------|-------------|
| `heal.fixed` | `{ module, resolution, durationMs? }` | Notifie qu'un module a été réparé |
| `heal.failed` | `{ module, error, attempts }` | Notifie qu'une réparation a échoué |
| `heal.diagnose` | `{ module }` | Diagnostique l'état d'un module |

```bash
curl -s -X POST http://127.0.0.1:3104/rpc \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":"1","method":"heal.diagnose","params":{"module":"brain"}}'
```

### :3105 — nexus_researcher (Recherche + Summarization)

| Méthode | Params | Description |
|---------|--------|-------------|
| `research.query` | `{ topic, depth? }` | Lance une recherche sur un sujet |
| `research.summarize` | `{ sourceIds: string[] }` | Résume des sources |

```bash
curl -s -X POST http://127.0.0.1:3105/rpc \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":"1","method":"research.query","params":{"topic":"BTC trends","depth":"deep"}}'
```

### :3106 — nexus_publisher (Notifications + Signaux)

| Méthode | Params | Description |
|---------|--------|-------------|
| `publish.trade-open` | `{ symbol, side, quantity, entryPrice, timestamp }` | Notifie l'ouverture d'un trade |
| `publish.trade-close` | `{ symbol, side, quantity, exitPrice, pnl?, reason? }` | Notifie la fermeture d'un trade |
| `publish.signal` | `{ message, channel? }` | Publie un signal sur un canal |

```bash
curl -s -X POST http://127.0.0.1:3106/rpc \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":"1","method":"publish.signal","params":{"message":"BTC bullish signal","channel":"trading"}}'
```

### Endpoints Communs (tous les bridges)

| Endpoint | Méthode HTTP | Description |
|----------|-------------|-------------|
| `/health` | GET | `{ agent, status, uptime, rpcMethods[], peerCount }` |
| `/rpc` | POST | JSON-RPC 2.0 dispatcher |
| `/shutdown` | POST | Arrêt propre du bridge |

### Routage RPC Interne

```
POST /rpc → dispatchRpc(method)
  1. health.ping → local (toujours)
  2. Méthode locale (registerRpcMethod) → handler local
  3. Sinon → forwardToMcp() → POST http://[::1]:3099/mcp
```

---

## Commandes RPC OverBridgeServer (Overmind)

Le `OverBridgeServer` (port 3100 par défaut, ou via discord_llm :3001) expose **24 méthodes JSON-RPC** :

### Agents (10 méthodes)

| Méthode | Params | Description |
|---------|--------|-------------|
| `agent.run` | `agentName, runner, prompt, sessionId?, model?, externalKey?` | Lance un agent |
| `agent.a2a` | `fromAgent, toAgent, runner, prompt, model?` | A→B (Agent-to-Agent) |
| `agent.broadcast` | `fromAgent, runner, prompt, targets[]?, race?` | 1→N fan-out global |
| `agent.pipeline` | `initiator, runner, prompt, steps[], accumulateContext?` | Chaîne A→B→C |
| `agent.fanout` | `fromAgent, runner, prompt, targets[], mergeStrategy?` | 1→N + merge |
| `agent.delegate` | `fromAgent, toAgent, runner, prompt, async?, callbackUrl?` | Fire-and-forget |
| `agent.query` | `fromAgent, runner, prompt, targets[], agentTimeoutMs?` | Multi-agent query |
| `agent.status` | `agentName, action?, runner?` | Status live |
| `agent.list` | `status?, runner?` | Liste des agents |
| `agent.kill` | `agentName, runner?` | Kill un agent |

### Messages (4 méthodes)

| Méthode | Params | Description |
|---------|--------|-------------|
| `message.history` | `toAgent?, fromAgent?, status?, limit?, offset?, sinceHours?` | Historique paginé |
| `message.get` | `id` (UUID) | Récupère un message |
| `message.replay` | `id` (UUID) | Rejoue un message |
| `message.stats` | — | Stats globales |

### Sessions (4 méthodes)

| Méthode | Params | Description |
|---------|--------|-------------|
| `session.get` | `externalKey, agentName` | Session d'un utilisateur |
| `session.list` | — | Toutes les sessions |
| `session.delete` | `externalKey, agentName` | Supprime une session |
| `session.stats` | — | Stats des sessions |

### Autres (6 méthodes)

| Méthode | Description |
|---------|-------------|
| `health.ping` | Liveness check |
| `webhook.sms` | Adapt + auto-dispatch webhook SMS |
| `GET /health` | Healthcheck enrichi |
| `POST /webhook/:provider` | Webhook HTTP (voipms, twilio, discord) |
| `GET /f/:filename` | Static file serve |
| `OPTIONS *` | CORS preflight |

---

## Commandes A2A Hub (MCP Tool)

Le tool MCP `a2a_hub` expose 8 actions pour la communication inter-agents :

| Action | Params | Description |
|--------|--------|-------------|
| `discover` | — | Liste tous les agents avec statut temps réel |
| `status` | `target` | État détaillé d'un agent |
| `send` | `target, message` | Message synchrone A→B |
| `delegate` | `target, message, callbackUrl?` | Tâche async (retourne taskId) |
| `pipeline` | `message, steps[]` | Chaîne séquentielle A→B→C |
| `fanout` | `targets[], message, mergeStrategy?` | 1→N parallèle + merge |
| `query` | `targets[], message` | Question rapide multi-agents |
| `broadcast` | `message, race?` | Message global à tous |

```python
# Exemples
a2a_hub(action="discover")
a2a_hub(action="send", target="nexus_trader", message="Analyse BTC")
a2a_hub(action="pipeline", message="Analyse le marché", steps=[{"agentName":"nexus_researcher"},{"agentName":"nexus_trader"}])
a2a_hub(action="fanout", targets=["nexus_trader","nexus_risk_manager"], message="BTC?", mergeStrategy="best")
a2a_hub(action="broadcast", message="Alerte!", race=true)
```

---

## Commandes CLI overmind-bridge

### Démarrer le serveur

```bash
overmind-bridge server --port 3100
```

### Appels one-shot

```bash
# Flag direct
overmind-bridge call agent.run --agent nexus_master --runner hermes --prompt "Analyse BTC"

# Stdin
echo "Analyse BTC" | overmind-bridge call agent.run --agent nexus_master --runner hermes --prompt-stdin

# Fichier + variables
overmind-bridge call agent.run --agent nexus_master --runner hermes \
  --prompt-file ./brief.txt --var ticker=BTC

# A2A
overmind-bridge call agent.a2a --from nexus_master --to nexus_trader --runner hermes \
  --prompt "Valide mon analyse"
```

### Gestion

```bash
overmind-bridge status          # Status de tous les agents
overmind-bridge health          # Health du serveur
overmind-bridge replay --id 7f3e8a1b-...  # Replay un message
overmind-bridge sessions list   # Liste des sessions
overmind-bridge sessions get --key "+141****7735" --agent pdf_bon_travail
overmind-bridge sessions rm --key "+141****7735" --agent pdf_bon_travail
```

---

## Commandes Hermes Profile Management

### Créer un agent

```bash
# Via MCP tool
create_agent(name: "trader_btc", runner: "hermes", prompt: "...", model: "glm-5.2")

# Via CLI
hermes profile create trader_btc --no-alias --description "Trader BTC"
hermes -p trader_btc config set model.provider z-ai
hermes -p trader_btc config set model.model glm-5.2
```

### Gérer les profils

```bash
hermes profile list                          # Lister
hermes profile show nexus_master             # Détails
hermes profile delete nexus_master --yes     # Supprimer
hermes -p nexus_master config set model.model "MiniMax-M3"  # Changer modèle
```

### Lancer un agent

```bash
# Via Gateway HTTP (recommandé — zero subprocess)
run_agent(runner: "hermes", agentName: "nexus_master", prompt: "...")

# Via CLI
hermes -p nexus_master chat -q "Analyse le BTC" -Q --yolo

# Via curl direct sur le Gateway
curl -X POST http://127.0.0.1:8642/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer ${API_SERVER_KEY}" \
  -H "X-Hermes-Profile: nexus_master" \
  -d '{"model":"glm-5.2","messages":[{"role":"user","content":"..."}],"stream":true}'
```

---

## Scripts Helper d'Installation

### NEXUS — Démarrage et gestion

| Script | Usage | Description |
|--------|-------|-------------|
| `scripts/start-all-bridges.cjs` | `node scripts/start-all-bridges.cjs` | Démarre les 6 bridges en parallèle |
| `scripts/stop-all-bridges.cjs` | `node scripts/stop-all-bridges.cjs` | Arrête les 6 bridges |
| `scripts/status-bridges.cjs` | `node scripts/status-bridges.cjs` | Status de chaque bridge |
| `scripts/seed-bridges.cjs` | `node scripts/seed-bridges.cjs` | Crée la structure + .env pour les 6 |
| `scripts/test-a2a.cjs` | `node scripts/test-a2a.cjs` | Test E2A inter-bridges |
| `scripts/postbuild.cjs` | `node scripts/postbuild.cjs` | Copie config + .env vers dist |

### Overmind — Build et install

```bash
# Build complet
cd Workflow && npm run build

# Lint
npm run lint

# Test
npm run test

# Vérification installation
npm run verify-install

# Setup complet (Docker + Postgres + MCP)
npm run setup
```

### discord_llm — Build et démarrage

```bash
cd discord_llm && npm run build && npm start
```

### Hermes Gateway — Activation

```bash
# Config dans config.yaml
gateway:
  platforms:
    api_server:
      enabled: true

# .env
API_SERVER_KEY=<key>
API_SERVER_ENABLED=1

# Redémarrer
hermes gateway restart
```

---

## Bugs Source Corrigés

### Overmind (Workflow/src/bridge/)

| Bug | Fichier | Fix |
|-----|---------|-----|
| `localhost` au lieu de `[::1]` (IPv4/IPv6 mismatch Windows) | `types.ts:159` | → `http://[::1]:3099/mcp` |
| `ping()` sans SSE Accept header (FastMCP rejette) | `BridgeProxy.ts:181` | → Ajout `Accept: text/event-stream` + fallback `GET /health` |
| `parseSseText` non importé dans `BridgeProxy` | `BridgeProxy.ts:25` | → Ajout import |
| Commentaire doc `localhost:3099` | `BridgeProxy.ts:11` | → `[::1]:3099` |

### NEXUS (Nexus/common/ + bridges/)

| Bug | Fichier | Fix |
|-----|---------|-----|
| MCP URL `/rpc` au lieu de `/mcp` (FastMCP 404) | `BaseBridge.ts:227` | → `${mcpBase}/mcp` avec SSE parsing |
| Timeout MCP hardcodé 60s | `BaseBridge.ts:232` | → `config.mcpTimeoutMs` (120s défaut) |
| `Date.now()` comme ID JSON-RPC (collision) | `BridgeClient.ts:36` | → `crypto.randomUUID()` |
| `appendFileSync` (sync I/O dans hot path) | `logger.ts:71` | → `appendFile` async + rotation 50MB |
| Méthodes RPC custom forwardées au MCP (404) | `BaseBridge.ts:174` | → `registerRpcMethod()` + dispatch local |
| `.env` introuvable après build (dist vs src) | `config.ts:20` | → `candidatePaths[]` multi-niveaux |
| `postbuild.cjs` ne copiait pas les `.env` | `postbuild.cjs` | → Ajout section 2: copy bridges/.env |
| `*/` dans JSDoc cassait le parser CJS | `postbuild.cjs:5` | → Reworded comment |
| Pas de graceful shutdown SIGINT/SIGTERM | `bridge.ts` (×6) | → Ajout handler `process.on('SIGINT')` |
| Pas de keep-alive HTTP (TCP handshake chaque call) | `BridgeClient.ts` | → `HttpAgent({ keepAlive: true })` partagé |

### discord_llm

| Bug | Fichier | Fix |
|-----|---------|-----|
| `localhost:3099` au lieu de `[::1]:3099` | `overmind-bridge.ts:63` | → `http://[::1]:3099/mcp` |
| `no-useless-assignment` lint errors | `overmind-bridge.ts:255,278` | → `let mcpStatus: string` (sans init) |