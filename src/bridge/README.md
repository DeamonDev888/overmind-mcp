# Overmind Bridge — JSON-RPC 2.0 Wrapper

Pont RPC au-dessus d'un serveur Overmind MCP. Permet à n'importe quel client
HTTP (curl, Python, fetch, Discord webhook, serveur SMS…) de parler aux
agents Overmind via une API REST simple, avec gestion de sessions
multi-tenant, persistance Postgres, webhooks et orchestration A2A.

## Sommaire

  - [Architecture](#architecture)
  - [Installation](#installation)
  - [Démarrage rapide](#démarrage-rapide)
  - [API JSON-RPC 2.0](#api-json-rpc-20)
  - [Méthodes disponibles](#méthodes-disponibles)
  - [CLI](#cli)
  - [Webhooks](#webhooks)
  - [Directives agent](#directives-agent)
  - [Sessions multi-tenant](#sessions-multi-tenant)
  - [Variables d'environnement](#variables-denvironnement)
  - [Sécurité](#sécurité)
  - [Tests](#tests)
  - [Déploiement Node + Systemd (Linux)](#déploiement-node--systemd-linux)

## Architecture

Trois couches, séparations claires :

  1. **BridgeProxy** (`BridgeProxy.ts`)
     Transport bas niveau : JSON-RPC 2.0 sur HTTP vers le serveur MCP
     Overmind (default: `http://localhost:3099/mcp`). Gère :
       - Circuit breaker (5 échecs → open 30s)
       - Retry automatique sur erreurs transitoires
       - Triple timeout (AbortController, deadline, per-chunk)
       - Health check via JSON-RPC `ping`

  2. **OverBridgeService** (`OverBridgeService.ts`)
     API métier haut niveau : `runAgent`, `memorySearch`,
     `memoryStore`, `listAgents`, `createPrompt`, etc. Wrappe
     BridgeProxy + gère la session continuity par instance.

  3. **OverBridgeServer** (`OverBridgeServer.ts`)
     Serveur HTTP JSON-RPC 2.0 entrant. Expose l'API au monde
     extérieur. Ajoute :
       - Validation Zod des paramètres
       - AgentRegistry (mutex par agent, état live)
       - MessageLog (persistence Postgres)
       - SessionStore (multi-tenant, TTL, persistence JSON)
       - DirectiveParser (extraction de directives dans les réponses)
       - WebhookAdapter (voipms, twilio, discord, generic)
       - Sanitizer JSON (Windows paths)
       - Serveur statique `/f/:filename`

Flux d'un appel :

```
HTTP client → POST /rpc → OverBridgeServer
                              ↓ (validate Zod)
                            AgentRegistry.withLock (mutex per agent)
                              ↓
                            OverBridgeService.runAgent
                              ↓
                            BridgeProxy.call (retry + circuit)
                              ↓
                            Overmind MCP :3099 (run_agent tool)
```

## Installation

Le bridge est inclus dans le package `overmind-mcp` :

```bash
npm install overmind-mcp
# ou
pnpm add overmind-mcp
```

Aucune dépendance supplémentaire pour le mode basique. Dépendances
optionnelles selon les features activées :

  - `pg` — pour MessageLog (Postgres)
  - `async-mutex` — pour AgentRegistry (mutex per agent)
  - `zod` — pour validation des params JSON-RPC
  - `yaml` — pour les fichiers scenario .yaml/.yml

## Démarrage rapide

### Mode serveur

Lance le serveur HTTP JSON-RPC 2.0 :

```bash
overmind-bridge server \
  --port 3100 \
  --host 127.0.0.1 \
  --postgres-host localhost \
  --postgres-user postgres \
  --postgres-password secret \
  --postgres-db overmind_memory \
  --enable-message-log \
  --enable-session-store \
  --enable-directives \
  --enable-webhooks
```

Endpoints exposés :

  - `POST /rpc` — JSON-RPC 2.0 (single + batch)
  - `GET /health` — santé du bridge (status, agents, messages, sessions)
  - `POST /webhook/:provider` — webhooks VoIP.ms, Twilio, Discord, generic
  - `GET /f/:filename` — fichiers statiques (depuis `BRIDGE_STATIC_DIR`)

### Mode library (Node)

```typescript
import { OverBridgeService, OverBridgeServer } from 'overmind-mcp/bridge';

const service = new OverBridgeService({
  mcpUrl: 'http://localhost:3099/mcp',
  defaultTimeoutMs: 60_000,
  agentTimeoutMs: 3_600_000,
});

await service.connect();

const server = new OverBridgeServer(service, {
  port: 3100,
  host: '127.0.0.1',
  postgres: { host: 'localhost', port: 5432, user: 'postgres', password: 'secret', database: 'overmind_memory' },
  enableMessageLog: true,
  enableSessionStore: true,
  enableDirectives: true,
  enableWebhooks: true,
  healthCheckIntervalMs: 30_000,
});

const { url } = await server.start();
console.log(`Bridge ready at ${url}/rpc`);
```

## API JSON-RPC 2.0

Toutes les méthodes suivent le protocole JSON-RPC 2.0. Le serveur
supporte les requêtes single et batch (array de requêtes).

### Format requête

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "agent.run",
  "params": {
    "agentName": "scout",
    "runner": "kilo",
    "prompt": "Analyse BTC en trend hebdomadaire"
  }
}
```

### Format réponse (succès)

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "result": {
    "messageId": "uuid-...",
    "sessionId": "hermes-sess-abc123",
    "content": [{ "type": "text", "text": "..." }],
    "isError": false,
    "directives": ["session", "context"]
  }
}
```

### Format réponse (erreur)

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "error": {
    "code": -32602,
    "message": "Invalid params",
    "data": [...]
  }
}
```

### Batch requests

```json
[
  { "jsonrpc": "2.0", "id": 1, "method": "agent.list", "params": {} },
  { "jsonrpc": "2.0", "id": 2, "method": "agent.status", "params": { "agentName": "scout" } }
]
```

## Méthodes disponibles

### `agent.run`

Lance un agent (depuis client externe ou depuis un autre agent).
Supporte SessionStore (externalKey), DirectiveParser, et mutex par
agent.

**Params :**
  - `agentName` (string, required) — Nom de l'agent
  - `runner` (string, required) — `claude` | `gemini` | `kilo` | `qwencli` | `openclaw` | `cline` | `opencode` | `hermes` | `antigravity`
  - `prompt` (string, required) — Le prompt à envoyer
  - `sessionId` (string, optional) — Pour reprendre une session
  - `path` (string, optional) — Working directory de l'agent
  - `model` (string, optional) — Modèle spécifique
  - `mode` (string, optional) — Mode (code, architect, ask, debug, etc.)
  - `silent` (boolean, optional) — Mode silencieux
  - `metadata` (object, optional) — Métadonnées additionnelles
  - `externalKey` (string, optional) — Clé externe pour SessionStore
    (phone, userId, channelId…)
  - `parseDirectives` (boolean, optional) — Override du flag serveur

**Exemple :**
```bash
curl -X POST http://127.0.0.1:3100/rpc \
  -H 'Content-Type: application/json' \
  -d '{
    "jsonrpc": "2.0",
    "id": 1,
    "method": "agent.run",
    "params": {
      "agentName": "scout",
      "runner": "kilo",
      "prompt": "Analyse BTC",
      "externalKey": "+14181234567"
    }
  }'
```

### `agent.a2a`

Agent A parle à Agent B (orchestration inter-agents). Le hub enrichit
le prompt avec un contexte A→B.

**Params :**
  - `fromAgent` (string, required)
  - `toAgent` (string, required)
  - `runner` (string, required)
  - `prompt` (string, required)
  - `model`, `path`, `metadata` (optionnels)

### `agent.status`

Status live d'un agent (busy/idle/online/offline). Possibilité de
proxier vers Overmind MCP `agent_control`.

**Params :**
  - `agentName` (string, required)
  - `runner` (string, optional)
  - `action` (enum: `status` | `stream` | `kill` | `wait`, default: `status`)
  - `sinceTimestamp` (number, optional)
  - `timeoutMs` (number, optional)

**Retour :** `{ local: AgentLiveState, mcp?: AgentResult }`

### `agent.list`

Liste tous les agents et leur état.

**Params :**
  - `status` (enum: `online` | `offline` | `busy` | `idle`, optional)
  - `runner` (string, optional)

**Retour :** `{ agents: AgentLiveState[], stats: {...} }`

### `agent.kill`

Kill un agent en cours.

**Params :**
  - `agentName` (string, required)
  - `runner` (string, optional)

### `message.history`

Historique des messages persistés (Postgres).

**Params :**
  - `toAgent` (string, optional)
  - `fromAgent` (string|null, optional) — null = clients externes
  - `status` (enum: `pending` | `running` | `done` | `failed` | `timeout`, optional)
  - `limit` (number, 1-500, default: 50)
  - `offset` (number, default: 0)
  - `sinceHours` (number, optional)

**Retour :** `{ messages: PersistedMessage[], count: number }`

### `message.get`

Récupère un message par UUID.

**Params :**
  - `id` (UUID, required)

### `message.replay`

Rejoue un message (relance l'agent avec le même prompt). Crée un
NOUVEAU message, l'ancien reste pour traçabilité.

**Params :**
  - `id` (UUID, required)

### `message.stats`

Statistiques globales du log (24h par défaut).

**Retour :** `{ total, byStatus, byRunner, avgDurationMs }`

### `session.get` / `session.list` / `session.delete` / `session.stats`

CRUD sur le SessionStore (multi-tenant par externalKey).

### `webhook.sms`

Reçoit un payload webhook, l'adapte via WebhookAdapter, et optionnellement
dispatch automatiquement vers un agent.

**Params :**
  - `provider` (enum: `voipms` | `twilio` | `discord` | `generic`, default: `voipms`)
  - `payload` (object, required) — Le payload brut
  - `externalKey` (string, optional) — Override de la clé
  - `autoDispatch` (object, optional) — Si fourni, dispatch vers agent
    - `agentName` (required)
    - `runner` (required)
    - `model`, `mode` (optionnels)

### `health.ping`

Ping simple (utile pour les healthchecks K8s/Docker).

**Retour :** `{ pong: true, ts: number }`

## CLI

Le binaire `overmind-bridge` est exposé. Sous-commandes principales :

### `server`

Lance le serveur HTTP JSON-RPC 2.0.

```bash
overmind-bridge server [options]
  --port <n>              Port (default: 3100)
  --host <h>              Host (default: 127.0.0.1)
  --postgres-host <h>     Postgres host
  --postgres-port <n>     Postgres port (default: 5432)
  --postgres-user <u>     Postgres user
  --postgres-password <p> Postgres password
  --postgres-db <d>       Postgres database
  --postgres-ssl          Active SSL
  --enable-message-log    Persist les messages
  --enable-session-store  Active SessionStore multi-tenant
  --enable-directives     Parse les directives agent
  --enable-webhooks       Expose /webhook/:provider
  --auth-token <t>        Token Bearer pour /rpc
  --json-body-limit <s>   Limite body (default: 10mb)
  --static-dir <path>     Dossier pour /f/:filename
```

### `call`

Appelle une méthode JSON-RPC unique.

```bash
overmind-bridge call <method> --params '{"key":"value"}' \
  --base-url http://127.0.0.1:3100 \
  --auth-token secret
```

### `scenario`

Exécute un scénario YAML/JSON multi-agents.

```bash
overmind-bridge scenario ./my-workflow.yaml \
  --base-url http://127.0.0.1:3100
```

Format scenario (extrait) :
```yaml
name: Analyse BTC complète
vars:
  ticker: BTC
steps:
  - id: scout
    type: run
    agent: scout
    runner: kilo
    prompt: "Analyse ${ticker} en trend hebdo"
  - id: validate
    type: a2a
    from: scout
    to: analyst
    runner: kilo
    prompt: "Valide ${scout.output}"
  - id: parallel
    type: parallel
    steps:
      - id: a
        type: run
        agent: a
        runner: kilo
        prompt: "..."
      - id: b
        type: run
        agent: b
        runner: kilo
        prompt: "..."
```

Steps supportés : `run`, `a2a`, `parallel`, `if`, `wait`.

### `health`

```bash
overmind-bridge health --base-url http://127.0.0.1:3100
```

## Webhooks

Si `enableWebhooks: true`, le serveur expose :

  - `POST /webhook/voipms`
  - `POST /webhook/twilio`
  - `POST /webhook/discord`
  - `POST /webhook/generic`

Chaque provider est normalisé via `WebhookAdapter` vers :

```typescript
{
  externalKey: string,    // pour SessionStore
  prompt: string,         // prompt déjà contextualisé
  mediaUrls: string[],
  metadata: object
}
```

Le webhook ne dispatche PAS automatiquement vers un agent. Pour
auto-dispatch, utilise plutôt la méthode RPC `webhook.sms` avec
`autoDispatch`. Exemple depuis Python :

```python
import requests
r = requests.post('http://127.0.0.1:3100/rpc', json={
    "jsonrpc": "2.0", "id": 1, "method": "webhook.sms",
    "params": {
        "provider": "voipms",
        "payload": {"from": "+14181234567", "message": "Bitcoin?", "id": "msg-1"},
        "autoDispatch": {"agentName": "sms_agent", "runner": "kilo"}
    }
})
```

## Directives agent

Les agents peuvent injecter des directives structurées dans leurs
réponses textuelles. Le bridge les extrait et les exécute, puis
supprime les directives du texte retourné au client.

**Directives supportées :**

  - `SESSION_ID: <id>` — Assigne un sessionId au store
  - `CONTEXT_UPDATE: key=val key2=val2` — Patche le context de la session
  - `BRIDGE_NEXT: method=agent.run agent=X prompt="..."` — Déclenche un appel suivant
  - `BRIDGE_END` — Arrête la chaîne BRIDGE_NEXT
  - `BRIDGE_HINT: <text>` — Tag/metadata (no action)

**Exemple de réponse agent :**
```
Voici mon analyse : BTC en trend haussier.

SESSION_ID: hermes-sess-abc123
CONTEXT_UPDATE: step=awaiting_validation score=85
BRIDGE_NEXT: method=agent.run agent=validator prompt="Score 85, valide"

Texte client-visible (sans les directives).
```

**Activation :** Server-level via `enableDirectives: true` ou par-call
via `params.parseDirectives: true`.

⚠️ **Attention :** les directives `SESSION_ID` et `BRIDGE_NEXT` sont
exécutées sans validation forte. Ne jamais laisser un agent externe
(non-trusted) injecter des directives.

## Sessions multi-tenant

Le SessionStore mappe une `externalKey` (phone, userId, channelId…) à
un `sessionId` réel. Pattern inspiré de bt-sms (TTL 4h).

**Comportement :**
  1. Client envoie `agent.run` avec `externalKey`
  2. Bridge cherche session existante pour `(externalKey, agentName)`
  3. Si trouvée → utilise le sessionId existant
  4. Si pas trouvée → run avec sessionId vide, puis store le nouveau
  5. À chaque run → met à jour `lastActivityAt`
  6. Cleanup périodique (5min) pour purger les sessions expirées
  7. Persistence atomique dans `~/.overmind/bridge/sessions.json`

**Auto-resolution :** si la réponse agent contient `SESSION_ID: xxx`
(directive), le bridge update automatiquement le store.

**Statistiques :**
```bash
overmind-bridge call session.stats
```

## Variables d'environnement

Toutes les options serveur sont surchargeables via env :

  - `BRIDGE_STATIC_DIR` — Dossier pour `/f/:filename` (default: `./public`)
  - `POSTGRES_HOST` / `POSTGRES_PORT` / `POSTGRES_USER` / `POSTGRES_PASSWORD` / `POSTGRES_DB` / `POSTGRES_SSL` / `POSTGRES_POOL_MIN` / `POSTGRES_POOL_MAX`
  - `BRIDGE_AUTH_TOKEN` — Token Bearer (si activé)
  - `MCP_URL` — URL du serveur MCP (default: `http://localhost:3099/mcp`)

Helper de chargement : `loadMessageLogConfigFromEnv()` dans `MessageLog.ts`.

## Sécurité

  - **Auth Bearer :** Active via `OverBridgeServerConfig.authToken`.
    Header requis : `Authorization: Bearer <token>`.
  - **Path traversal :** Le serveur `/f/:filename` valide que le
    fichier résolu reste sous `BRIDGE_STATIC_DIR` (fix récent).
  - **Sanitization JSON :** Active via `sanitizeJson: true` — répare
    les Windows paths non échappés dans le body.
  - **Body limit :** Default 10mb, configurable via `jsonBodyLimit`.
  - **Circuit breaker :** Auto-ferme après 5 échecs consécutifs,
    half-open après 30s.
  - **Mutex per agent :** Garantit qu'un seul run tourne par agent.
  - **Session TTL :** 4h par défaut, configurable.

⚠️ **Pas de rate limiting** : ajouter un reverse proxy (nginx, Caddy)
si exposé publiquement.

## Tests

```bash
pnpm test                                    # Tous les tests
pnpm test -- bridge/OverBridgeServer.test.ts # Un fichier
```

## Déploiement Node + Systemd (Linux)

Cible : Ubuntu 24.04+ (ou toute distro systemd). Le binaire
`overmind-bridge` est exposé via `package.json` (champ `bin`).

### 1. Build du projet

```bash
git clone <repo-url> overmind-mcp
cd overmind-mcp
pnpm install           # ou npm install
pnpm run build         # produit dist/bin/overmind-bridge.js
```

Vérifier que le binaire existe :
```bash
ls -la dist/bin/overmind-bridge.js
node dist/bin/overmind-bridge.js --version   # ou --help
```

### 2. Installation en mode global (optionnel)

```bash
# Soit via npm link (dev)
npm link

# Soit install global (prod)
npm install -g .
which overmind-bridge
```

### 3. Créer un utilisateur système dédié

Ne pas faire tourner le bridge en root.

```bash
sudo useradd --system \
  --home /opt/overmind-mcp \
  --shell /usr/sbin/nologin \
  --comment "Overmind Bridge service" \
  overmind
```

### 4. Préparer le dossier de déploiement

```bash
sudo mkdir -p /opt/overmind-mcp
sudo cp -r dist node_modules package.json /opt/overmind-mcp/
sudo chown -R overmind:overmind /opt/overmind-mcp

sudo mkdir -p /var/log/overmind
sudo chown overmind:overmind /var/log/overmind

sudo mkdir -p /etc/overmind
sudo chown overmind:overmind /etc/overmind
```

### 5. Fichier d'environnement

```bash
sudo tee /etc/overmind/bridge.env > /dev/null <<'EOF'
# ─── MCP upstream ─────────────────────────────────────────────
MCP_URL=http://127.0.0.1:3099/mcp

# ─── Server bind ──────────────────────────────────────────────
BRIDGE_HOST=127.0.0.1
BRIDGE_PORT=3100

# ─── Auth (Bearer token — génères-en un solide) ──────────────
BRIDGE_AUTH_TOKEN=change-me-to-a-64-char-random-string

# ─── Postgres (MessageLog) ───────────────────────────────────
POSTGRES_HOST=127.0.0.1
POSTGRES_PORT=5432
POSTGRES_USER=overmind
POSTGRES_PASSWORD=secret
POSTGRES_DB=overmind_memory
POSTGRES_POOL_MIN=2
POSTGRES_POOL_MAX=10

# ─── Static files (optionnel) ────────────────────────────────
# BRIDGE_STATIC_DIR=/opt/overmind-mcp/public

# ─── Node tuning ─────────────────────────────────────────────
NODE_OPTIONS=--max-old-space-size=512
EOF

sudo chmod 600 /etc/overmind/bridge.env
sudo chown overmind:overmind /etc/overmind/bridge.env
```

### 6. Unit file systemd

```bash
sudo tee /etc/systemd/system/overmind-bridge.service > /dev/null <<'EOF'
[Unit]
Description=Overmind Bridge (JSON-RPC 2.0 HTTP wrapper for Overmind MCP)
Documentation=https://github.com/<org>/overmind-mcp
After=network-online.target
Wants=network-online.target
# Si Postgres tourne en local et doit être up avant le bridge :
# After=postgresql.service
# Requires=postgresql.service

[Service]
Type=simple
User=overmind
Group=overmind
WorkingDirectory=/opt/overmind-mcp
EnvironmentFile=/etc/overmind/bridge.env

# Commande de démarrage
ExecStart=/usr/bin/node \
  --max-old-space-size=512 \
  --no-warnings \
  dist/bin/overmind-bridge.js server \
    --host ${BRIDGE_HOST} \
    --port ${BRIDGE_PORT} \
    --auth-token ${BRIDGE_AUTH_TOKEN} \
    --postgres-host ${POSTGRES_HOST} \
    --postgres-port ${POSTGRES_PORT} \
    --postgres-user ${POSTGRES_USER} \
    --postgres-password ${POSTGRES_PASSWORD} \
    --postgres-db ${POSTGRES_DB} \
    --enable-message-log \
    --enable-session-store \
    --enable-directives \
    --enable-webhooks

# Redémarrage automatique
Restart=always
RestartSec=5
StartLimitInterval=60
StartLimitBurst=10

# Logs vers journald + fallback fichier
StandardOutput=journal
StandardError=journal
SyslogIdentifier=overmind-bridge

# Hardening (sandboxing basique)
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ProtectHome=true
ReadWritePaths=/opt/overmind-mcp /var/log/overmind
ProtectKernelTunables=true
ProtectKernelModules=true
ProtectControlGroups=true
RestrictNamespaces=true
RestrictRealtime=true
LockPersonality=true
MemoryDenyWriteExecute=true

[Install]
WantedBy=multi-user.target
EOF
```

Notes :
  - `MemoryDenyWriteExecute` peut casser certains runners (Kilo, Cline)
    qui JIT. Si tu vois des crashs au démarrage des agents, retire
    cette ligne.
  - `ReadWritePaths` doit inclure tous les dossiers où le bridge écrit
    (sessions.json, logs). Ajoute `/etc/overmind/bridge/sessions.json`
    si tu utilises un chemin custom pour `SessionStore`.

### 7. Activer et démarrer

```bash
sudo systemctl daemon-reload
sudo systemctl enable overmind-bridge.service
sudo systemctl start overmind-bridge.service
```

### 8. Vérifications

État du service :
```bash
sudo systemctl status overmind-bridge.service
```

Logs en temps réel (journald) :
```bash
sudo journalctl -u overmind-bridge.service -f
# ou avec grep
sudo journalctl -u overmind-bridge.service -n 200 --no-pager
```

Health check via HTTP :
```bash
curl -s http://127.0.0.1:3100/health | jq .
# ou sans auth (si pas activé)
curl -s -H 'Authorization: Bearer <token>' http://127.0.0.1:3100/health | jq .
```

Test d'un agent.run (avec auth) :
```bash
TOKEN=$(grep BRIDGE_AUTH_TOKEN /etc/overmind/bridge.env | cut -d= -f2)

curl -s -X POST http://127.0.0.1:3100/rpc \
  -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{
    "jsonrpc": "2.0", "id": 1, "method": "health.ping", "params": {}
  }' | jq .
```

### 9. Reverse proxy optionnel (nginx, Caddy)

Si tu exposes le bridge derrière un reverse proxy (recommandé pour
TLS, rate limiting, logs centralisés) :

**nginx minimal :**
```nginx
server {
  listen 443 ssl http2;
  server_name bridge.example.com;

  ssl_certificate     /etc/letsencrypt/live/bridge.example.com/fullchain.pem;
  ssl_certificate_key /etc/letsencrypt/live/bridge.example.com/privkey.pem;

  # Rate limit basique
  limit_req_zone $binary_remote_addr zone=bridge:10m rate=10r/s;

  location / {
    limit_req zone=bridge burst=20 nodelay;
    proxy_pass http://127.0.0.1:3100;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;

    # Streaming SSE si l'upstream en produit
    proxy_buffering off;
    proxy_read_timeout 3600s;
  }
}
```

**Caddy (encore plus simple) :**
```
bridge.example.com {
  reverse_proxy 127.0.0.1:3100
}
```

### 10. Mise à jour

```bash
cd /opt/overmind-mcp
sudo -u overmind git pull
sudo -u overmind pnpm install --frozen-lockfile
sudo -u overmind pnpm run build
sudo systemctl restart overmind-bridge.service
sudo systemctl status overmind-bridge.service
```

Ou script de deploy minimal :
```bash
sudo tee /usr/local/bin/overmind-deploy > /dev/null <<'EOF'
#!/bin/bash
set -euo pipefail
cd /opt/overmind-mcp
sudo -u overmind git pull
sudo -u overmind pnpm install --frozen-lockfile
sudo -u overmind pnpm run build
sudo systemctl restart overmind-bridge.service
sleep 2
sudo systemctl is-active --quiet overmind-bridge.service && \
  echo "✅ Bridge running" || \
  (echo "❌ Bridge failed" && sudo journalctl -u overmind-bridge.service -n 50)
EOF
sudo chmod +x /usr/local/bin/overmind-deploy
```

### 11. Désinstallation

```bash
sudo systemctl stop overmind-bridge.service
sudo systemctl disable overmind-bridge.service
sudo rm /etc/systemd/system/overmind-bridge.service
sudo systemctl daemon-reload
sudo rm -rf /opt/overmind-mcp /etc/overmind /var/log/overmind
sudo userdel overmind
```

## Licence

Voir `LICENSE` à la racine du repo.
