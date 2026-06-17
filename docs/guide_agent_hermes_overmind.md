# 🤖 Guide : Créer un Agent Hermes Permanent avec Overmind

> **Pour les débutants** — De zéro à un agent autonome fonctionnel, step by step.

---

## 📖 Table des Matières

1. [Concepts de Base](#-concepts-de-base)
2. [Architecture 2 Couches](#-architecture-2-couches)
3. [Hermes Gateway vs Overmind](#-hermes-gateway-vs-overmind)
4. [Bridge SDK — Wrappers TypeScript](#-bridge-sdk--wrappers-typescript)
5. [Architecture Dossier Agent](#-architecture-dossier-agent)
6. [Les 4 Fichiers Cruciaux](#-les-4-fichiers-cruciaux)
7. [Créer un Agent — Tutorial Complet](#-créer-un-agent--tutorial-complet)
8. [Configuration Avancée](#-configuration-avancée)
9. [Skills — Compétences Hermes](#-skills--compétences-hermes)
10. [MCP Servers — Outils](#-mcp-servers--outils)
11. [Mémoire — 3 Couches](#-mémoire--3-couches)
12. [Cron — Agent vs Persistant](#-cron--agent-vs-persistant)
13. [Workflow Type](#-workflow-type)
14. [Troubleshooting](#-troubleshooting)

---

## 🧠 Concepts de Base

### Qu'est-ce qu'un Agent Hermes ?

Un **agent Hermes** est une instance isolée d'IA avec :
- Son propre **system prompt** (SOUL.md)
- Ses propres **clés API** (.env)
- Ses propres **skills** (compétences)
- Sa propre **mémoire locale** (state.db + MEMORY.md)
- Sa propre **configuration** (modèle, MCP, TTS)

### Qu'est-ce qu'Overmind ?

**Overmind** est l'**encapsuleur** qui gère plusieurs agents :
- **CRUD agents** (create, config, delete)
- **Orchestration** (run_agent, run_agents_parallel)
- **Mémoire locale/agent** (memory_store, memory_search — DB propre par agent)
- **Mémoire partagée** (cross-agents, transmission inter-agents)
- **Cron persistant** (survit aux redémarrages)
- **Agent Control** (status, stream, kill, wait)
- **Bridge SDK** (wrappers TypeScript)

### Qu'est-ce que le Bridge ?

Le **Bridge** (`bridge/`) est un SDK TypeScript qui wrappe les appels Overmind MCP. Il permet de piloter les agents depuis une app externe (Discord bot, API REST, CLI).

---

## 📐 Architecture 2 Couches

```
┌──────────────────────────────────────────────────┐
│                  OVERMIND                         │
│          L'Encapsuleur / Orchestrator             │
│                                                   │
│  CRUD agents • Orchestration • Mémoire partagée   │
│  Mémoire locale/agent • Cron PERSISTANT • Bridge  │
│                                                   │
│  ┌────────────────────────────────────────────┐   │
│  │           HERMES GATEWAY                    │   │
│  │        Le Runtime Agent                     │   │
│  │                                             │   │
│  │  SOUL.md • Skills • TTS • MCP Client        │   │
│  │  Mémoire locale • Sessions • Cron agent     │   │
│  └────────────────────────────────────────────┘   │
└──────────────────────────────────────────────────┘
```

**Point clé** : Overmind encapsule Hermes. Ce sont 2 couches distinctes.

---

## 🔀 Hermes Gateway vs Overmind

| Fonctionnalité | Hermes Gateway | Overmind |
|---|---|---|
| **Persona (SOUL.md)** | ✅ Gère et exécute | — |
| **Skills** | ✅ Charge et injecte | — |
| **TTS** | ✅ Exécute la synthèse | — |
| **MCP Client** | ✅ Se connecte aux serveurs | — |
| **Mémoire fichiers plats** | ✅ MEMORY.md, USER.md, state.db | — |
| **Mémoire locale DB** | — | ✅ memory_store/search (DB propre/agent) |
| **Mémoire partagée** | — | ✅ Cross-agents, include_runs |
| **Session** | ✅ SQLite par agent | — |
| **Cron agent-level** | ✅ Session fraîche chaque tick | — |
| **Terminal/Fichiers** | ✅ Outils d'exécution | — |
| **Agent CRUD** | — | ✅ create, config, delete |
| **Orchestration** | — | ✅ run_agent, run_agents_parallel |
| **Cron PERSISTANT** | — | ✅ Survit aux redémarrages |
| **Agent Control** | — | ✅ status, stream, kill, wait |
| **Bridge SDK** | — | ✅ Wrappers TypeScript |
| **Registre agents** | — | ✅ .overmind/hermes/ |

---

## 🔗 Bridge SDK — Wrappers TypeScript

### Architecture en 3 Couches

```
App → OverBridgeService → BridgeProxy → Overmind MCP → Hermes Gateway
```

### Les 5 Fichiers

| Fichier | Rôle | Lignes |
|---|---|---|
| `types.ts` | Contrats : `McpResponse`, `AgentResult`, `BridgeConfig`, `SessionState` | ~150 |
| `utils.ts` | Logger, SSE parsing, retry, validation, formatage Discord | ~170 |
| `BridgeProxy.ts` | Transport JSON-RPC 2.0 : circuit breaker, 3 couches timeout | ~285 |
| `OverBridgeService.ts` | API Overmind : `runAgent()`, `memorySearch()`, `runParallel()` | ~284 |
| `index.ts` | Barrel export | ~46 |

### Ce que le Bridge Wrappe (Overmind uniquement)

```typescript
// Orchestration (Overmind → lance Hermes)
bridge.runAgent('agent', 'hermes', 'prompt')
bridge.runAgentForDiscord('agent', 'hermes', msg, ctx)
bridge.runParallel([...agents])

// Mémoire partagée (Overmind)
bridge.memorySearch({ query: 'trading' })
bridge.memoryStore({ text: 'Décision...', source: 'decision' })

// Agent CRUD (Overmind)
bridge.listAgents()
bridge.createAgent('nom', 'hermes', 'prompt')

// Agent Control (Overmind)
bridge.agentControl({ agentName: 'x', action: 'status' })
```

### Circuit Breaker + Session Persistante

- **Circuit Breaker** : Closed → Open (5 échecs) → Half-Open → Closed (3 succès)
- **Session** : auto-persistée dans `SessionState`, `autoResume: true`

---

## 📁 Architecture Dossier Agent

```
.overmind/hermes/<agent_name>/
│
├── .hermes/                         ← HERMES GATEWAY (runtime agent)
│   ├── SOUL.md                      ← Persona
│   ├── config.yaml                  ← Modèle + MCP + TTS
│   ├── .env                         ← Clés API
│   ├── state.db                     ← Mémoire locale SQLite
│   ├── skills/                      ← Compétences Hermes
│   ├── sessions/                    ← Historique sessions
│   ├── memories/                    ← MEMORY.md + USER.md
│   ├── cron/                        ← Cron agent-level Hermes
│   ├── logs/                        ← Logs
│   └── audio_cache/                 ← TTS
│
└── (fichiers de travail)

.overmind/agents/                    ← REGISTRE OVERMIND
bridge/                             ← SDK OVERMIND (wrappers TypeScript)
```

---

## 📄 Les 4 Fichiers Cruciaux (Hermes Gateway)

### 1. `SOUL.md` — Le Cerveau
System prompt. Définit personnalité, règles, comportements.

### 2. `config.yaml` — Configuration Runtime
Modèle, MCP servers, TTS. Géré par Hermes, configuré via Overmind.

### 3. `.env` — Les Secrets
Clés API. **JAMAIS de commit Git.**

### 4. `state.db` — Mémoire SQLite
Historique conversations, sessions, cache. **Géré automatiquement par Hermes.**

---

## 🚀 Créer un Agent — Tutorial

### Via Overmind MCP

```bash
# 1. Créer (OVERMIND)
create_agent(name: "mon_agent", runner: "hermes", prompt: "Tu es...")

# 2. Configurer (OVERMIND)
update_agent_config(name: "mon_agent", model: "glm-5.2",
  mcpServers: ["memory-server", "discord-server"])

# 3. Clés (OVERMIND)
update_agent_config(name: "mon_agent", env: { "OPENAI_API_KEY": "sk-..." })

# 4. Lancer (OVERMIND orchestre, HERMES exécute)
run_agent(runner: "hermes", agentName: "mon_agent", prompt: "Analyse...")
```

### Via Bridge SDK

```typescript
import { OverBridgeService } from './bridge/index.js';
const bridge = new OverBridgeService({ mcpUrl: 'http://localhost:3099/mcp' });

const result = await bridge.runAgent('mon_agent', 'hermes', 'Mon prompt');
const results = await bridge.runParallel([...]);
```

---

## ⚙️ Configuration Avancée (Hermes Gateway)

### Multi-Modèles
```bash
run_agent(runner: "hermes", agentName: "x", model: "claude-sonnet-4", prompt: "...")
```

### TTS
```yaml
tts:
  provider: elevenlabs
  voice: charlie
  voice_id: IKne3meq5aSn9XLyUdCD
  model: eleven_multilingual_v2
```

---

## 🎯 Skills — Compétences Hermes

Skills = fichiers `SKILL.md` chargés par Hermes Gateway.

```
skills/
└── catégorie/
    └── skill/
        ├── SKILL.md
        ├── references/
        ├── scripts/
        └── templates/
```

~100+ built-in : `autonomous-ai-agents`, `creative`, `github`, `research`, `devops`...

```bash
skill_manage(action: "create", name: "mon-skill", content: "...")
```

---

## 🔌 MCP Servers — Outils des Agents

| Serveur | Port | Fonction |
|---|---|---|
| `memory-server` | 3099 | Mémoire locale/agent + partagée Overmind + CRUD agents |
| `discord-server` | 3141 | Messages, embeds, fichiers Discord |
| `x-mcp-server` | 3142 | Scraping Twitter/X |
| `postgresql-server` | 5433 | SQL + Vector search |

---

## 🧠 Mémoire — 3 Couches

### 1. Mémoire Hermes Gateway (fichiers plats, par agent)

Injectée dans le prompt à chaque tour. Gérée par l'agent lui-même via `memory()`.

```bash
memory(action: "add", target: "memory", content: "Préfère réponses courtes")
memory(action: "replace", target: "user", old_text: "old", content: "new")
```

| Fichier | Rôle | Portée |
|---|---|---|
| `MEMORY.md` | Notes personnelles de l'agent | 1 agent |
| `USER.md` | Profil et préférences utilisateur | 1 agent |
| `state.db` | SQLite (sessions, cache) | 1 agent |

### 2. Mémoire Overmind Locale (DB propre par agent)

**Chaque agent a sa PROPRE base de données Overmind** — isolation complète.
Les `memory_store` et `memory_search` sont **locale à l'agent** par défaut.

```bash
# Stockage dans la DB locale de l'agent
memory_store(text: "Décision : BlockChat v0.2", source: "decision")
memory_search(query: "BlockChat protocol")
```

- Chaque agent = sa propre DB vectorielle
- Recherche sémantique dans les connaissances de l'agent
- Types : `user`, `agent`, `pattern`, `error`, `decision`

### 3. Mémoire Overmind Partagée (cross-agents)

En plus de sa DB locale, un agent peut accéder à une mémoire **commune** partagée entre tous les agents.

```bash
# Accès mémoire partagée (cross-agents)
memory_search(query: "trading strategy", include_runs: true)
```

- Partagée entre tous les agents de la flotte
- Inclut l'historique des runs (`include_runs: true`)
- Permet la transmission de connaissances inter-agents

---

## ⏰ Cron — Agent vs Persistant

### Cron Hermes Gateway (agent-level)
- Session **fraîche** à chaque tick
- Même profil, même MCP, pas de contamination
- Lié au cycle de vie de l'agent
- Config via `cronjob()` dans l'agent

### Cron Overmind (PERSISTANT)
- Géré au niveau de l'**encapsuleur**
- **Survit aux redémarrages** de l'agent ET du gateway
- Stocké dans le registre Overmind
- Indépendant du cycle de vie Hermes

```bash
# Cron Hermes (agent-level)
cronjob(action: "create", name: "analyse", schedule: "0 9 * * *",
  prompt: "Analyse crypto...")

# Cron Overmind (persistant)
# → Configuré via Bridge SDK ou API Overmind
# → Survit aux redémarrages
```

---

## 🔄 Workflow Type

### Mono-Agent
```
create_agent (OVERMIND) → config (OVERMIND) → run_agent (OVERMIND → HERMES)
```

### Multi-Agents
```
Orchestrateur (OVERMIND)
  ├─► run_agents_parallel([agent1, agent2, agent3])
  └─► Consolidate → Discord
```

### Via Bridge
```
App → OverBridgeService → BridgeProxy → Overmind MCP → Hermes Gateway
```

---

## 🔧 Troubleshooting

### L'agent ne démarre pas
- Vérifier `SOUL.md` non vide (Hermes)
- Vérifier `config.yaml` valide (Hermes)
- Checker `logs/errors.log` (Hermes)

### MCP Server non connecté
- Vérifier le port dans `config.yaml` (Hermes)
- Tester `curl http://localhost:PORT/mcp`

### Bridge — Circuit breaker ouvert
- 5 échecs → circuit open
- Attendre 30s ou `bridge.healthCheck()`

### Cron perdu après redémarrage
- Cron Hermes = par session (pas persistant)
- Cron Overmind = persistant (survit)
- Vérifier quel niveau de cron est utilisé

### Mémoire pleine
- `MEMORY.md` / `USER.md` ont des limites
- `memory(action: "remove")` pour nettoyer

---

## 📊 Checklist Nouvel Agent

- [ ] `create_agent()` (OVERMIND)
- [ ] `update_agent_config()` — modèle (OVERMIND)
- [ ] `update_agent_config()` — MCP servers (OVERMIND)
- [ ] `update_agent_config()` — .env (OVERMIND)
- [ ] Tester avec `run_agent()` (OVERMIND → HERMES)
- [ ] Stocker premiers faits en `memory_store()` (OVERMIND)
- [ ] Configurer Bridge SDK si orchestration externe (OVERMIND)

---

> **Dernière mise à jour** : 30 mai 2026
> **Auteur** : Sniperbot Analyst (agent Hermes permanent)
> **Basé sur** : Infrastructure Overmind (encapsuleur) + Hermes Gateway (runtime)
