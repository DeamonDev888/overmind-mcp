# Guide Complet : Setup d'un agent Hermes persistant (Discord) avec Overmind

**Audience :** admin Linux qui part de zéro et veut un bot Discord alimenté par
MiniMax-M3 (ou n'importe quel provider LLM), avec persistance, MCP Discord,
et toutes les subtilités de la subtilisation comprises.

**Pré-requis :** Linux (Ubuntu 24+ recommandé), `sudo` activé, accès à un
compte Discord bot + token.

**Stack final :**
- Node.js 22 LTS
- Docker (PostgreSQL + pgvector pour la mémoire vectorielle)
- overmind-mcp 2.8.40+ (`npm i -g overmind-mcp`)
- hermes-agent 0.16.0+ (`pip install hermes-agent` ou `npm i -g hermes-agent`)
- discord_llm (le bridge Discord ↔ Overmind)
- Un token MiniMax CN (sk-cp-* ou sk-mm-*) — voir §5

---

## 1. Préparation système (Linux fresh)

```bash
# 1.1 Mise à jour
sudo apt update && sudo apt upgrade -y

# 1.2 Paquets de base
sudo apt install -y curl git build-essential python3 python3-pip python3-venv \
                    ripgrep jq ca-certificates gnupg lsb-release

# 1.3 Node.js 22 LTS
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt install -y nodejs
node --version    # v22.x

# 1.4 Docker (pour PostgreSQL + pgvector)
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker $USER
newgrp docker
docker --version

# 1.5 PostgreSQL + pgvector via Docker
docker run -d --name overmind-postgres \
  -e POSTGRES_PASSWORD=<your-pg-password> \
  -e POSTGRES_DB=overmind \
  -p 5433:5432 \
  pgvector/pgvector:pg16
# Note: on utilise 5433 (pas 5432) pour éviter les conflits
sleep 5
docker exec overmind-postgres psql -U postgres -c "CREATE DATABASE bt_clients;"
```

---

## 2. Installation globale d'Overmind + Hermes

```bash
# 2.1 Overmind MCP (l'orchestrateur multi-runner)
sudo npm i -g overmind-mcp
overmind --version    # doit afficher 2.8.40+

# 2.2 Hermes Agent (le moteur LLM)
pip install hermes-agent
hermes --version          # doit afficher 0.16.0+

# 2.3 Premier setup de Hermes (auth + workspace)
hermes setup
# → crée ~/.hermes/, te demande de login à un provider
# → ne login PAS ici (Overmind va gérer ça dynamiquement)
```

---

## 3. Setup du workspace Overmind

```bash
# 3.1 Créer le workspace
mkdir -p ~/overmind-workflow && cd ~/overmind-workflow
overmind init
# → crée .overmind/, .mcp.json, .claude/, etc.

# 3.2 Variables d'environnement minimales
cat > .env <<'EOF'
# PostgreSQL
POSTGRES_HOST=localhost
POSTGRES_PORT=5433
POSTGRES_DB=overmind
POSTGRES_USER=postgres
POSTGRES_PASSWORD=<your-pg-password>

# MiniMax CN (vos tokens — voir §5)
ANTHROPIC_AUTH_TOKEN_1=***votre_token_CN_valide***
ANTHROPIC_AUTH_TOKEN_2=***votre_token_CN_valide***

# Convention user: MiniMax = CN par défaut
OVERMIND_MINIMAX_DEFAULT=cn
EOF
chmod 600 .env
```

> [!IMPORTANT]
> **Déclaration du Workspace (`OVERMIND_WORKSPACE`)**
> Pour éviter les erreurs de résolution (notamment le problème de la poule et de l'œuf où le `.env` de projet n'est pas lu car le chemin du workspace n'est pas encore identifié), il est fortement conseillé de déclarer le chemin du workspace au niveau du système ou de la configuration de service, et non dans le `.env` du projet :
> * **Via Systemd** : Ajoutez `WorkingDirectory=/chemin/du/projet` ou `Environment=OVERMIND_WORKSPACE=/chemin/du/projet` dans la section `[Service]` de votre fichier d'unité.
> * **Via le Shell** : Exécutez `export OVERMIND_WORKSPACE="/chemin/du/projet"` (et ajoutez-le dans `.bashrc` ou `.profile` pour persister).

---

## 4. Configuration des agents Hermes — La subtilisation expliquée

### 4.1 Le concept

Overmind supporte **4 runners** : `claude`, `kilo`, `openclaw`, `hermes`.
Pour ne pas réinventer la roue 4 fois, Overmind utilise **un format unifié**
pour TOUS les runners : `Workflow/.claude/settings_<agent>.json`.

Quand le runner `hermes` est invoqué, il **convertit** ce format unifié vers
le **format canonique Hermes** (`<HERMES_HOME>/agents/<name>/settings.json`)
au moment du spawn. C'est la "subtilisation" : Overmind déduit
automatiquement quels env vars provider-specific seed (e.g. `MINIMAX_CN_API_KEY`)
à partir du token + URL.

### 4.2 L'arborescence canonique (3 couches)

```
~/overmind-workflow/                         ← workspace Overmind
├── .claude/                                ← COUCHE 1 (source, tu édites)
│   ├── settings_<agent>.json               ← format Overmind unifié
│   └── agents/<agent>.md                   ← (legacy, ignoré par Hermes)
├── .mcp.json                               ← registre MCP servers HTTP
├── .env                                    ← tokens + secrets ($VAR)
├── .overmind/hermes/                       ← HERMES_HOME (root partagé)
│   ├── agents/<agent>/                     ← COUCHE 2 (canonique, auto-généré)
│   │   ├── settings.json                   ← écrit par le runner
│   │   ├── SOUL.md                         ← persona de l'agent
│   │   ├── sessions/  logs/  memories/    ← Hermes upstream écrit
│   ├── config.yaml                         ← COUCHE 3 (Hermes global, auto-bootstrappé)
│   ├── auth.json                           ← COUCHE 3 (credential pool, Hermes global)
│   ├── sessions/  logs/                    ← partagés entre agents
└── src/                                    ← code source Overmind (si dev)
```

**3 couches pour 3 raisons :**
- **Source** `.claude/settings_<name>.json` = portable entre 4 runners (Claude/Kilo/OpenClaw/Hermes)
- **Canonique** `.overmind/hermes/agents/<name>/settings.json` = ce qu'Hermes upstream lit
- **Globale** `.overmind/hermes/config.yaml` + `auth.json` = état partagé, géré par Hermes upstream

### 4.3 La subtilisation — TABLE DE MAPPING (le coeur du fix 2.8.x)

Quand le runner Overmind écrit le settings.json canonique, il **injecte**
automatiquement des env vars provider-specific. Le user n'a qu'à mettre
`ANTHROPIC_AUTH_TOKEN` + `ANTHROPIC_BASE_URL` dans le source — le runner
fait le reste.

| Token prefix dans `ANTHROPIC_AUTH_TOKEN` | URL contient | → env vars seedées dans le canonique |
|---|---|---|
| `sk-cp-*` ou `sk-mm-*` | `minimaxi` (avec le `i`) | `MINIMAX_CN_API_KEY` + `MINIMAX_CN_BASE_URL=https://api.minimaxi.com/anthropic` |
| `sk-cp-*` ou `sk-mm-*` | `minimax` (sans le `i`) | `MINIMAX_API_KEY` + `MINIMAX_BASE_URL=https://api.minimax.io/anthropic` |
| `sk-cp-*` ou `sk-mm-*` | vide | `MINIMAX_CN_*` (défaut `OVERMIND_MINIMAX_DEFAULT=cn`) |
| 32hex ou 32hex.32hex | n/a | `ZAI_ANTHROPIC_FALLBACK_KEY` + `GLM_API_KEY` |
| autre `sk-*` | n/a | rien de plus (laisser `ANTHROPIC_AUTH_TOKEN`) |

**Pourquoi c'est subtil :** le binaire Hermes upstream a 31+ plugins
provider-specific. Chaque plugin lit des env vars différentes :
- Plugin `minimax-cn` lit `MINIMAX_CN_API_KEY`
- Plugin `minimax` (GLOBAL) lit `MINIMAX_API_KEY`
- Résolveur provider lit `MINIMAX_CN_BASE_URL` (PAS `ANTHROPIC_BASE_URL`)

Si tu mets juste `ANTHROPIC_AUTH_TOKEN`, **le plugin upstream va
silencieusement 401** parce qu'il cherche une autre env var. Le runner
Overmind fait le mapping pour toi.

---

## 5. Obtenir un token MiniMax CN valide

```bash
# 5.1 Créer un compte sur https://api.minimaxi.com (CN, pas GLOBAL)

# 5.2 Générer une clé API (préfixe sk-cp-)
# → Copier la clé dans ANTHROPIC_AUTH_TOKEN_1 du .env

# 5.3 Tester
curl -X POST https://api.minimaxi.com/anthropic/v1/messages \
  -H "x-api-key: $ANTHROPIC_AUTH_TOKEN_1" \
  -H "anthropic-version: 2023-06-01" \
  -H "content-type: application/json" \
  -d '{"model": "MiniMax-M3", "max_tokens": 32, "messages": [{"role": "user", "content": "ping"}]}'
# → Doit retourner 200 avec une réponse du modèle
```

⚠️ **Tous les tokens sk-cp-* ne sont pas forcément valides sur CN** —
certains comptes sont GLOBAL (`api.minimax.io` sans le `i`). Vérifie
toujours avec curl avant d'investir du temps de debug.

---

## 6. Créer un agent Hermes — l'exemple sniperbot_analyst

### 6.1 Le source settings (COUCHE 1)

**`~/overmind-workflow/.claude/settings_sniperbot_analyst.json`**

```json
{
  "env": {
    "ANTHROPIC_AUTH_TOKEN": "$ANTHROPIC_AUTH_TOKEN_1",
    "ANTHROPIC_BASE_URL":   "https://api.minimaxi.com/anthropic",
    "ANTHROPIC_MODEL":      "MiniMax-M3",
    "ANTHROPIC_PROVIDER":   "minimax-cn"
  },
  "enableAllProjectMcpServers": true,
  "enabledMcpjsonServers": [],
  "agent": "sniperbot_analyst",
  "runner": "hermes"
}
```

**Notes :**
- `$ANTHROPIC_AUTH_TOKEN_1` est résolu depuis `.env` au moment du spawn
- `enableAllProjectMcpServers: true` = tous les serveurs MCP du `.mcp.json` sont chargés
- `enabledMcpjsonServers: []` = pas de filtre additionnel (vide = "tout")
- **`MINIMAX_CN_API_KEY` et `MINIMAX_CN_BASE_URL` ne sont PAS ici** — le runner les auto-seed (subtilisation 2.8.34)

### 6.2 Le registre MCP servers (commun à tous les agents)

**`~/overmind-workflow/.mcp.json`**

⚠️ **IMPORTANT** : les noms de serveurs DOIVENT matcher les clés du
`config.yaml` Hermes (`.overmind/hermes/config.yaml:mcp_servers:`). Les
deux registries ont des conventions différentes — le runner Overmind essaie
de matcher mais ça peut casser.

**Format recommandé** (kebab-case anglais) :

```json
{
  "mcpServers": {
    "memory-server":    { "type": "http", "url": "http://localhost:3099/mcp" },
    "discord-server":   { "type": "http", "url": "http://localhost:3141/mcp" },
    "x_server":         { "type": "http", "url": "http://localhost:3142/mcp" },
    "postgres":         { "type": "http", "url": "http://localhost:5433/mcp" },
    "voipms-mcp":       { "type": "http", "url": "http://localhost:3146/mcp" }
  }
}
```

### 6.3 Le persona de l'agent (SOUL.md)

**`~/overmind-workflow/.overmind/hermes/agents/sniperbot_analyst/SOUL.md`**

Ce fichier est créé automatiquement par le runner au premier spawn, mais
tu peux le pré-créer. Format : markdown libre.

```markdown
# Sniperbot Analyst — Ton persona

Tu es un analyste financier Discord pour le serveur VIBE DEV. Tu réponds
toujours via les outils MCP Discord (jamais de texte brut après un appel).

## Tes tools MCP Discord (17 outils réels)
- mcp_discord_server_gestion_messages (action: envoyer, lire, modifier, supprimer, reagir)
- mcp_discord_server_creer_embed (embed builder avec 22+ thèmes)
- mcp_discord_server_gestion_membres (action: lister, info, timeout, warn, ban, kick)
- mcp_discord_server_gestion_canaux (action: lister, creer, modifier, supprimer)
... (voir l'inventaire complet du MCP Discord server)

## Tes tools Overmind
- mcp_overmind_server_run_agent (spawner un sous-agent)
- mcp_overmind_server_list_agents (lister 92 agents)
- mcp_overmind_server_memory_search / memory_store
- mcp_overmind_server_update_agent_config
```

### 6.4 Le config.yaml Hermes (COUCHE 3, auto-bootstrappé par le runner)

**`~/overmind-workflow/.overmind/hermes/config.yaml`**

Ce fichier est créé automatiquement par le runner Overmind au premier
spawn (depuis `~/.hermes/config.yaml` par défaut). Contient au minimum :

```yaml
mcp_servers:
  discord-server:
    url: http://localhost:3141/mcp
  memory-server:
    url: http://localhost:3099/mcp
  postgres:
    url: http://localhost:5433/mcp
  voipms-mcp:
    url: http://localhost:3146/mcp
  x_server:
    url: http://localhost:3142/mcp
```

**Les noms ici sont ce que `--toolsets` accepte.** Si tu mets
`serveur_discord` ici, le runner ne pourra pas activer les tools via
`--toolsets` (il faut le même nom partout).

---

## 7. Lancer l'agent via MCP

```bash
# 7.1 Démarrer le serveur MCP Overmind (qui sert run_agent)
overmind start --port 3099

# 7.2 Invoquer l'agent depuis n'importe quel client MCP
# (Claude Code, Continue.dev, ou directement via curl + JSON-RPC 2.0)

# Exemple: test direct
mcp-client call overmind run_agent \
  --agentName "sniperbot_analyst" \
  --runner "hermes" \
  --prompt "ping - réponds juste OK"
# → Réponse: "OK"
# → Log: provider=minimax-cn, model=MiniMax-M3, latency=4-6s
```

**Le serveur MCP est sur port 3099** par défaut. Il sert le tool
`run_agent` qui prend `{agentName, runner, prompt, model?}`.

---

## 8. Brancher Discord (le bot + bridge)

### 8.1 Le bot Discord Node.js (discord_llm)

```bash
# 8.1.1 Créer un bot Discord sur https://discord.com/developers/applications
# → Copier le token

# 8.1.2 Cloner discord_llm (le wrapper Overmind+Discord)
git clone https://github.com/DeamonDev888/discord_llm.git ~/discord_llm
cd ~/discord_llm
npm install

# 8.1.3 Configurer
cat > .env <<'EOF'
DISCORD_BOT_TOKEN=***votre_token_bot_discord***
CLAUDE_SERVER_PORT=3001
RUNNER=hermes
BRIDGE_AGENT=sniperbot_analyst
OVERMIND_MCP_URL=http://localhost:3099/mcp
EOF

# 8.1.4 Build + start
npm run build
npm start
# → "Bot Discord connecté et maintenu en vie"
# → "🔗 Claude Server: http://localhost:3001"
```

### 8.2 Le bridge HTTP port 3001

Le bot Discord fait `POST localhost:3001/send` au bridge, qui forward
vers `mcp__overmind__run_agent` (port 3099). Le bridge est inclus dans
`discord_llm/src/overmind-bridge.ts` et est démarré automatiquement par
`npm start`.

### 8.3 Tester end-to-end

```
!sniper ping
```

Le bot Discord :
1. Reçoit le message dans le channel VIBE DEV
2. POST `/send` au bridge (port 3001)
3. Bridge → MCP Overmind (port 3099) → run_agent(agentName="sniperbot_analyst", runner="hermes", prompt="ping")
4. Runner Overmind → spawn `hermes chat -q "ping" --model MiniMax-M3 --provider minimax-cn --yolo`
5. Hermes upstream → POST api.minimaxi.com/anthropic/v1/messages
6. Réponse "OK" → MCP → bridge → bot Discord → message sur VIBE DEV
```

---

## 9. Update / maintenance (le cas Linux)

```bash
# 9.1 Update Overmind MCP
sudo npm update -g overmind-mcp
overmind --version  # doit afficher la nouvelle version

# 9.2 Update Hermes
pip install --upgrade hermes-agent
hermes --version

# 9.3 Restart les services (l'ordre compte)
# 1. Postgres (toujours en premier)
docker restart overmind-postgres

# 2. MCP servers tiers (discord, x, voipms)
docker restart discord-mcp  # ou systemctl restart discord-mcp
docker restart x-mcp
docker restart voipms-mcp

# 3. Overmind MCP server
pkill -f "overmind start"
overmind start --port 3099 &

# 4. Discord bot + bridge
pkill -f "discord_llm"
cd ~/discord_llm && npm start &

# 9.4 Vérifier que tout marche
curl http://localhost:3099/mcp     # doit retourner 200
curl http://localhost:3141/mcp     # MCP Discord
curl http://localhost:3001/status  # bridge
```

---

## 10. Debug checklist (quand ça marche pas)

| Symptôme | Cause probable | Fix |
|---|---|---|
| `HTTP 401: Missing Authentication header` | Token pas passé à Hermes | Vérifier `$ANTHROPIC_AUTH_TOKEN_1` est résolu, `MINIMAX_CN_API_KEY` est seedé dans le canonique |
| `HTTP 401: invalid api key` | Mauvais endpoint | Vérifier `api.minimaxi.com` (CN avec `i`) vs `api.minimax.io` (GLOBAL) |
| `HTTP 402: insufficient balance` | Token sans budget | Changer `$ANTHROPIC_AUTH_TOKEN_1` → `_2` ou `_7` |
| `Warning: Unknown toolsets` | Noms de toolsets mismatch `.mcp.json` vs `config.yaml` | Standardiser les noms (kebab-case) |
| Sniperbot dit "j'ai pas de MCP" mais log montre 69 tools registered | SOUL.md désaligné | Réécrire le SOUL.md pour lister les vrais tools |
| "Provider: openrouter" au lieu de "minimax-cn" | `--provider` flag pas passé | Vérifier que le runner a `--provider` dans cleanArgs |
| `EXIT_CODE_1` sur le bridge | MCP server tourne l'ancien build | `pkill -f overmind && overmind start &` |
| "Erreur inconnue" générique | Stale state dans `.overmind/hermes/agents/<name>/.hermes/` | Migrer vers `agents/<name>/` (le helper `getAgentHermesHome` 2.8.30 le fait auto) |
| `cleanupTempFiles` efface le settings.json canonique | settings.json pushé dans `tempFiles` | Bug fixé en 2.8.32 — ne pas push |

---

## 11. Le pipeline complet (visualisation)

```
[Discord] "!sniper ping"
  ↓
[discord_llm bot Node.js]   (port N/A, websocket Discord)
  ↓ POST /send
[discord_llm bridge HTTP]   (port 3001, Express)
  ↓ JSON-RPC 2.0
[Overmind MCP server]       (port 3099)
  ↓ run_agent()
[NousHermesRunner.runAgentInternal()]
  ├─ Lit  .claude/settings_sniperbot_analyst.json    (COUCHE 1, source)
  ├─ Interpol $VAR depuis .env
  ├─ Subtilisation 2.8.34 (sk-cp + minimaxi → MINIMAX_CN_API_KEY)
  ├─ Écrit .overmind/hermes/agents/sniperbot_analyst/settings.json  (COUCHE 2)
  ├─ Bootstrap config.yaml (COUCHE 3) si manquant
  └─ Spawn `hermes chat -q ... --model MiniMax-M3 --provider minimax-cn --yolo`
       avec HERMES_HOME=<workspace>/.overmind/hermes/
       (et si enableAllProjectMcpServers=true, --toolsets avec les noms de config.yaml)
  ↓
[Hermes upstream]           (subprocess)
  ├─ Lit agents/sniperbot_analyst/settings.json
  ├─ Lit agents/sniperbot_analyst/SOUL.md
  ├─ Charge les MCP servers de config.yaml:mcp_servers:
  └─ Construit un client Anthropic
  ↓
[api.minimaxi.com/anthropic]   (endpoint MiniMax CN)
  POST /v1/messages  { model: "MiniMax-M3", ... }
  ↓
[Réponse du modèle] → Hermes → MCP → bridge → bot Discord → message sur VIBE DEV
```

---

## 12. Cas particuliers & FAQ

### Q: Pourquoi 3 couches de config et pas juste 1 ?

**R:** Polyglot par design. Overmind = orchestrateur multi-runner (4 runners),
donc il parle 4 formats. Si on n'avait qu'Overmind+Hermes, on pourrait tout
mettre dans le canonique. Mais comme on supporte aussi ClaudeRunner/KiloRunner/
OpenClawRunner qui ont leurs propres formats, le source unifié (COUCHE 1) est
plus simple à maintenir.

### Q: Pourquoi mon agent dit "j'ai pas de MCP" alors qu'il les a ?

**R:** Biais de prompting. Le SOUL.md est trop prescriptif (il dit "j'utilise
toujours Discord" au lieu de lister factuellement les tools). Solution :
réécrire le SOUL.md pour être un inventaire factuel.

### Q: Le runner peut-il fonctionner sans Discord ?

**R:** Oui. Le runner est 100% agnostique du canal de sortie. Tu peux
invoquer un agent via `mcp__overmind__run_agent` directement (sans Discord),
via Discord (via le bot + bridge), via cron job, via webhook, etc. La
sortie revient au caller.

### Q: Comment ajouter un nouveau provider LLM (e.g. Mistral) ?

**R:** 4 étapes :
1. Ajouter le détecteur de token dans `src/services/NousHermesRunner.ts`
   (voir section "Subtilisation" 4.3)
2. Ajouter le case dans `src/tools/config_example.ts`
3. Ajouter le profile dans `~/.hermes/config.yaml` (section `providers:`)
4. Documenter dans `docs/provider-config-map.md`

### Q: Différence entre `enableAllProjectMcpServers: true` et `enabledMcpjsonServers: [...]` ?

**R:**
- `enableAllProjectMcpServers: true` = charger tous les serveurs du `.mcp.json` (Overmind registry)
- `enabledMcpjsonServers: [...]` = charger SEULEMENT les serveurs listés (filtre)
- Si les deux sont set, le filtre gagne (`enabledMcpjsonServers` est plus spécifique)
- Si les deux sont vides/absents, AUCUN MCP n'est chargé (l'agent a juste les tools Hermes natifs)

### Q: Comment tester sans payer ?

**R:** 3 options :
1. **Anthropic officiel** : `claude-sonnet-4-6` via ton compte (5$ gratuits au start)
2. **OpenRouter** (embeddings only par convention user) — ne PAS utiliser pour LLM
3. **Z.AI GLM** : modèles `glm-4.5-air` gratuits en bêta

---

## 13. TL;DR (le strict minimum)

```bash
# 1. Install
sudo npm i -g overmind-mcp
pip install hermes-agent

# 2. Workspace
mkdir ~/overmind-workflow && cd ~/overmind-workflow
echo 'ANTHROPIC_AUTH_TOKEN_1=sk-cp-***' > .env
echo 'OVERMIND_MINIMAX_DEFAULT=cn' >> .env

# 3. Source agent
mkdir -p .claude .mcp.json
cat > .claude/settings_sniper.json <<EOF
{
  "env": {
    "ANTHROPIC_AUTH_TOKEN": "\$ANTHROPIC_AUTH_TOKEN_1",
    "ANTHROPIC_BASE_URL":   "https://api.minimaxi.com/anthropic",
    "ANTHROPIC_MODEL":      "MiniMax-M3",
    "ANTHROPIC_PROVIDER":   "minimax-cn"
  },
  "enableAllProjectMcpServers": true,
  "agent": "sniper", "runner": "hermes"
}
EOF

# 4. MCP servers
cat > .mcp.json <<EOF
{"mcpServers":{"memory-server":{"type":"http","url":"http://localhost:3099/mcp"}}}
EOF

# 5. Start
overmind start --port 3099 &

# 6. Test
mcp-client call overmind run_agent \
  --agentName sniper --runner hermes --prompt "ping"
# → "OK"
```

C'est tout. Le reste (canonique, config.yaml, SOUL.md, Discord bridge) est
auto-généré par le runner. Si tu as besoin de Discord, ajoute discord_llm
(§8).

---

## 14. Versions & changelog

| Version | Date | Fix majeur |
|---|---|---|
| 2.8.28 | 2026-06 | Premier fix 401 — interpolation $VAR cassée |
| 2.8.29 | 2026-06 | Settings canonique prime sur .hermes/.env stale |
| 2.8.30 | 2026-06 | Refactor format canonique Hermes (appdirs style) |
| 2.8.32 | 2026-06 | Subtilisation : auto-seed MINIMAX_CN_API_KEY |
| 2.8.33 | 2026-06 | Subtilisation : auto-seed MINIMAX_CN_BASE_URL |
| 2.8.34 | 2026-06 | Re-add `--provider` flag (bypass auto-router bug) |
| 2.8.36 | 2026-06 | `--toolsets` flag passé au CLI |
| 2.8.37 | 2026-06 | Bootstrap config.yaml dans HERMES_HOME partagé |
| 2.8.38 | 2026-06 | SOUL.md sniperbot aligné (envoyer_message → gestion_messages) |
| 2.8.39 | 2026-06 | Toolsets lus depuis config.yaml (pas .mcp.json) |
| 2.8.40 | 2026-06 | SOUL.md full rewrite avec inventaire 17 tools |

---

## 15. Crédits & références

- **Overmind MCP** : https://github.com/DeamonDev888/overmind-mcp
- **Hermes Agent** : https://hermes-agent.nousresearch.com/docs
- **MiniMax API** : https://api.minimaxi.com (CN) / https://api.minimax.io (GLOBAL)
- **MCP Discord server** : https://github.com/DeamonDev888/discord-mcp-server (v2.1.3)
- **discord_llm** : https://github.com/DeamonDev888/discord_llm
- **Exemple vivant** : sniperbot_analyst sur VIBE DEV (serveur Discord <discord-server-id>)
- **CHANGELOG** : voir `Workflow/CHANGELOG.md` pour l'historique complet
- **SUBTILISATION** : voir `~/SUBTILISATION_EXPLAINED.txt` (doc originale)
- **Flow diagram** : voir `Workflow/docs/OVERMIND_HERMES_SNIPERBOT_FLOW.md`

---

**Auteur :** Nicolas (chef d'équipe Bon-air, compagnon charpentier-menuisier)
**Mainteneur :** toi + tes agents Hermes (autrement dit, ce guide est vivant)
