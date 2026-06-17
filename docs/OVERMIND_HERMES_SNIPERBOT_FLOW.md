# Comment fonctionne Overmind + Hermes sniperbot_analyst

## TL;DR

Quand tu fais `!sniper` sur Discord, **3 couches de config** sont traversées
en cascade avant qu'Hermes upstream envoie la requête à `api.minimaxi.com`.
C'est un design polyglot : 1 format Overmind runner + 1 format Hermes
canonique + 1 format config globale. Pas le choix si on veut supporter
4 runners (Claude, Kilo, OpenClaw, Hermes) avec un seul format unifié.

---

## Le flow complet

```
[1] Discord channel <discord-channel-id>
   user écrit "!sniper quel est ton model"
   ↓
[2] discord_llm/src/discord-bot.ts  (bot Node.js Discord.js)
   handleSniperCommand() → sendToClaudeServer(content, userId, ...)
   POST http://localhost:3001/send   {message, userId, channelId}
   ↓
[3] discord_llm/src/overmind-bridge.ts  (serveur HTTP Express)
   app.post('/send') → service.runAgentForDiscord(
       'sniperbot_analyst', 'hermes', message
   )
   ↓
[4] overmind-mcp bridge (package npm installé dans discord_llm/node_modules)
   BridgeProxy → JSON-RPC 2.0 vers http://localhost:3099/mcp
   méthode "run_agent" { runner: "hermes", agentName: "sniperbot_analyst", prompt }
   ↓
[5] Workflow/src/server.ts  (MCP server sur port 3099)
   tool: mcp__overmind__run_agent
   → NousHermesRunner.runAgentInternal(...)
   ↓
[6] Workflow/src/services/NousHermesRunner.ts  (le runner)
   ── Phase A : Lit Workflow/.claude/settings_sniperbot_analyst.json
   ── Phase B : Interpole les $VAR depuis Workflow/.env
   ── Phase C : Détecte le provider (subtilisation 2.8.34)
   ── Phase D : Écrit Workflow/.overmind/hermes/agents/sniperbot_analyst/settings.json
   ── Phase E : Spawn `hermes chat -q ... --model MiniMax-M3 --provider minimax-cn`
                avec HERMES_HOME=Workflow/.overmind/hermes/
   ↓
[7] Hermes upstream  (binaire `hermes` v0.16.0+ installé via `npm i -g hermes-agent`)
   Lit Workflow/.overmind/hermes/agents/sniperbot_analyst/settings.json
   + Lit Workflow/.overmind/hermes/agents/sniperbot_analyst/SOUL.md
   + Charge les MCP servers de Workflow/.mcp.json
   + Construit un client OpenAI/Anthropic
   ↓
[8] api.minimaxi.com/anthropic  (endpoint MiniMax CN)
   Authorization: Bearer <MINIMAX_CN_API_KEY du settings.json>
   POST /v1/messages { model: "MiniMax-M3", ... }
   ↓
[9] Réponse → Discord (réponse du sniperbot affichée dans le channel)
```

---

## Les 3 couches de config

### Couche 1 : Source Overmind runner (ce que TU édites)

**`Workflow/.claude/settings_sniperbot_analyst.json`**

Format unifié Overmind, partagé entre tous les runners. Tu mets ici :
- `env.ANTHROPIC_AUTH_TOKEN` (= `$VAR` à interpoler depuis `.env`)
- `env.ANTHROPIC_BASE_URL` (= endpoint API)
- `env.ANTHROPIC_MODEL`
- `enableAllProjectMcpServers: true|false`
- `enabledMcpjsonServers: [...]` (noms des MCP servers à charger)
- `agent`, `runner`

### Couche 2 : Settings canonique Hermes (auto-généré)

**`Workflow/.overmind/hermes/agents/sniperbot_analyst/settings.json`**

Format canonique qu'Hermes upstream attend. Le runner l'écrit à chaque spawn.
Contient **en plus** du source :
- `MINIMAX_CN_API_KEY` (= valeur du token, seedée par la subtilisation)
- `MINIMAX_CN_BASE_URL` (= endpoint CN, seedé par la subtilisation)
- `runner: "hermes"` (forcé)
- `agent: "sniperbot_analyst"` (forcé)

### Couche 3 : Config globale Hermes (gérée par Hermes upstream)

**`Workflow/.overmind/hermes/config.yaml`** + **`auth.json`**

Hermes upstream écrit/lit ces fichiers pour :
- Modèle par défaut global
- Pool de credentials (par provider : `minimax-cn`, `zai`, `openrouter`, `qwen-oauth`)
- État des credentials (`last_status: ok` / `exhausted`)

**On ne touche JAMAIS** à ces fichiers depuis le runner.

---

## Les subtilisations du runner (2.8.34+)

Quand le runner écrit le settings.json canonique, il **injecte** des env vars
spécifiques au provider détecté, basées sur :

| Token prefix | URL contient | → seed |
|---|---|---|
| `sk-cp-*` ou `sk-mm-*` | `minimaxi` (avec le `i`) | `MINIMAX_CN_API_KEY` + `MINIMAX_CN_BASE_URL=https://api.minimaxi.com/anthropic` |
| `sk-cp-*` ou `sk-mm-*` | `minimax` (sans le `i`) | `MINIMAX_API_KEY` + `MINIMAX_BASE_URL=https://api.minimax.io/anthropic` |
| `sk-cp-*` ou `sk-mm-*` | vide | `MINIMAX_CN_*` (défaut `OVERMIND_MINIMAX_DEFAULT=cn`) |
| 32hex ou 32hex.32hex | n/a | `ZAI_ANTHROPIC_FALLBACK_KEY` + `GLM_API_KEY` |
| autre `sk-*` | n/a | rien de plus (laisser `ANTHROPIC_AUTH_TOKEN` comme fallback) |

**Tu n'as qu'à mettre `ANTHROPIC_AUTH_TOKEN` + `ANTHROPIC_BASE_URL` dans le
source settings — le runner fait le mapping pour toi.**

---

## Les fichiers à connaître

```
Workflow/
├── .claude/
│   ├── settings_sniperbot_analyst.json          ← COUCHE 1 : source (tu édites)
│   ├── agents/sniperbot_analyst.md              ← (legacy, ignoré par Hermes runner)
│   └── .mcp.json                                ← (legacy, ignoré par Hermes runner)
├── .mcp.json                                    ← registry MCP servers HTTP
├── .env                                         ← tokens + secrets
├── .overmind/hermes/                            ← HERMES_HOME (root canonique)
│   ├── agents/sniperbot_analyst/                ← COUCHE 2 : auto-généré
│   │   ├── settings.json                        ← écrit par le runner
│   │   ├── SOUL.md                              ← persona
│   │   ├── sessions/  logs/  memories/          ← Hermes upstream écrit
│   ├── config.yaml                              ← COUCHE 3 : Hermes global
│   ├── auth.json                                ← COUCHE 3 : credential pool
│   ├── sessions/  logs/                         ← partagés entre agents
├── src/services/NousHermesRunner.ts             ← le runner (Overmind)

discord_llm/
├── src/discord-bot.ts                           ← le bot Discord (!sniper)
├── src/overmind-bridge.ts                       ← le bridge HTTP port 3001
└── node_modules/overmind-mcp/                   ← package npm installé
```

---

## Pourquoi 3 couches (et pas 1)

- **Format Overmind unifié** (`.claude/settings_<name>.json`) = portable entre
  4 runners (Claude, Kilo, OpenClaw, Hermes). C'est l'API publique Overmind.

- **Format Hermes canonique** (`agents/<name>/settings.json`) = ce que le
  binaire `hermes` upstream lit. A des champs spécifiques aux plugins
  (`MINIMAX_CN_API_KEY`, etc.) que seul le runner connaît.

- **Config globale Hermes** (`config.yaml`, `auth.json`) = état partagé entre
  tous les agents (credential pool, modèle par défaut, etc.). Géré par Hermes
  upstream — on n'y touche pas.

**Si tu veux 100% Hermes natif** (sans Overmind), utilise directement
`hermes chat -q "..." --yolo` (le `.bat` launcher qui marche, vu au début).
Mais tu perds :
- L'orchestration multi-agents
- Le swap auto de tokens sur 401/429/5xx
- L'unification Claude/Kilo/OpenClaw/Hermes

---

## Pour invoquer directement (test)

```
mcp__overmind__run_agent({
  agentName: "sniperbot_analyst",
  runner: "hermes",
  prompt: "ping"
})
```

Le runner fait : load source → interpolate → detect provider → write canonique
→ spawn hermes → return result.

## Pour invoquer via Discord

```
!sniper ping
```

Le bot Discord → bridge HTTP port 3001 → MCP server port 3099 → runner
→ hermes → api.minimaxi.com → Discord reply.

---

## Testé et fonctionnel (2026-06-07, 17:25)

- `mcp__overmind__run_agent(agentName="sniperbot_analyst", runner="hermes", prompt="ping")`
  → `"OK"` ✅
- `provider=minimax-cn, base_url=https://api.minimaxi.com/anthropic, model=MiniMax-M3` ✅
- `MINIMAX_CN_API_KEY` et `MINIMAX_CN_BASE_URL` auto-seedées ✅
- Token `$ANTHROPIC_AUTH_TOKEN_1` (interpolé depuis `.env`) ✅
- `enableAllProjectMcpServers: true` → 9 MCP servers chargés ✅
