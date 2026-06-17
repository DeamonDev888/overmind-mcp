# 🤖 Guide : Agent Hermes Permanent — Persistance & Orchestration

> **Objectif** : Construire un agent IA persistant, connecté à Discord, avec mémoire, bridge modulaire, et orchestration multi-agents.

---

## 📐 Architecture — 2 Couches Bien Distinctes

```
┌──────────────────────────────────────────────────┐
│                  OVERMIND                         │
│          L'Encapsuleur / Orchestrator             │
│                                                   │
│  • Agent CRUD (create, delete, list, config)      │
│  • Orchestration (run_agent, run_agents_parallel) │
│  • Mémoire partagée (memory_store/search cross-agents)│
│  • Mémoire locale/agent (DB propre par agent)        │
│  • Cron PERSISTANT (survit aux redémarrages)      │
│  • Agent Control (status, stream, kill, wait)     │
│  • Bridge SDK (TypeScript wrappers)               │
│  • Registre agents (.overmind/hermes/)            │
│                                                   │
│  ┌────────────────────────────────────────────┐   │
│  │           HERMES GATEWAY                    │   │
│  │        Le Runtime Agent                     │   │
│  │                                             │   │
│  │  • SOUL.md → persona/voix                  │   │
│  │  • Skills (~100+ built-in)                  │   │
│  │  • Mémoire locale (MEMORY.md, USER.md)      │   │
│  │  • TTS (ElevenLabs, OpenAI...)              │   │
│  │  • MCP Client (connecte aux serveurs)       │   │
│  │  • Terminal, fichiers, browser...           │   │
│  │  • Cron agent-level (session fraîche)       │   │
│  │  • Session SQLite (state.db)                │   │
│  └────────────────────────────────────────────┘   │
└──────────────────────────────────────────────────┘
```

**Point clé** : Overmind encapsule Hermes. Chaque couche a ses propres responsabilités.

---

## 🔀 Qui Fait Quoi ? — Hermes vs Overmind

| Fonctionnalité | Hermes Gateway | Overmind |
|---|---|---|
| **Persona (SOUL.md)** | ✅ Gère | — |
| **Skills** | ✅ Charge et injecte | — |
| **TTS** | ✅ Exécute | — |
| **MCP Client** | ✅ Se connecte aux serveurs | — |
| **Mémoire fichiers plats** | ✅ MEMORY.md, USER.md | — |
| **Mémoire locale DB** | — | ✅ memory_store/search (DB propre/agent) |
| **Mémoire partagée** | — | ✅ Cross-agents, include_runs |
| **Session** | ✅ state.db (SQLite) | — |
| **Cron (agent-level)** | ✅ Session fraîche à chaque tick | — |
| **Agent CRUD** | — | ✅ create, config, delete |
| **Orchestration** | — | ✅ run_agent, run_agents_parallel |
| **Mémoire partagée** | — | ✅ memory_store, memory_search (cross-agents) |
| **Cron PERSISTANT** | — | ✅ Survit aux redémarrages |
| **Agent Control** | — | ✅ status, stream, kill, wait |
| **Bridge SDK** | — | ✅ Wrappers TypeScript |
| **Registre agents** | — | ✅ .overmind/hermes/ |

### ⏰ Cron — La Différence Importante

**Hermes Gateway Cron** :
- Tourne dans une **session fraîche** à chaque tick
- Même profil, même MCP, mais pas de contamination entre runs
- Lié au cycle de vie de l'agent
- Configuration via `cronjob()` dans l'agent

**Overmind Cron PERSISTANT** :
- Géré au niveau de l'**encapsuleur**
- **Survit aux redémarrages** de l'agent et du gateway
- Stocké dans le registre Overmind
- Indépendant du cycle de vie Hermes
- Configuration via le Bridge SDK ou l'API Overmind

---

## 📁 Structure des Fichiers

```
.overmind/
├── hermes/                          ← Runtime Hermes (géré par Overmind)
│   ├── agent_mon_bot/               ← Agent isolé
│   │   ├── .hermes/                 ← Cerveau (géré par Hermes Gateway)
│   │   │   ├── SOUL.md              ← Persona
│   │   │   ├── config.yaml          ← Modèle + MCP + TTS
│   │   │   ├── .env                 ← Clés API
│   │   │   ├── state.db             ← Mémoire locale SQLite
│   │   │   ├── memories/            ← MEMORY.md + USER.md
│   │   │   ├── skills/              ← Compétences
│   │   │   ├── sessions/            ← Historique
│   │   │   ├── cron/                ← Cron agent-level
│   │   │   ├── logs/                ← Logs
│   │   │   └── audio_cache/         ← TTS
│   │   └── (fichiers de travail)
│   └── ...
├── agents/                          ← Registre Overmind
└── bridge/                          ← SDK TypeScript (couche Overmind)
    ├── index.ts                     ← Barrel export
    ├── types.ts                     ← Contrats partagés
    ├── utils.ts                     ← Logger, SSE, retry
    ├── BridgeProxy.ts               ← Transport JSON-RPC
    └── OverBridgeService.ts         ← API haut niveau Overmind
```

---

## 🔗 Bridge SDK — Wrappers Overmind en TypeScript

Le dossier `bridge/` est un **SDK modulaire** qui wrappe les appels MCP Overmind. Il permet de piloter les agents depuis une app externe.

### Architecture en 3 Couches

```
App/Discord Bot → OverBridgeService → BridgeProxy → Overmind MCP (localhost:3099)
                                                             → Hermes Gateway
```

| Fichier | Rôle | Lignes |
|---|---|---|
| `types.ts` | Contrats : `McpResponse`, `AgentResult`, `BridgeConfig`, `SessionState` | ~150 |
| `utils.ts` | Logger, SSE parsing, retry, validation, formatage Discord | ~170 |
| `BridgeProxy.ts` | Transport JSON-RPC 2.0 : circuit breaker, 3 couches timeout | ~285 |
| `OverBridgeService.ts` | API Overmind : `runAgent()`, `memorySearch()`, `runParallel()` | ~284 |
| `index.ts` | Barrel export | ~46 |

### Ce que le Bridge Wrappe (fonctionnalités Overmind)

```typescript
// Orchestration
bridge.runAgent('agent', 'hermes', 'prompt')        // Lancer un agent
bridge.runAgentForDiscord('agent', 'hermes', msg, ctx) // Avec contexte Discord
bridge.runParallel([...])                            // Flotte multi-agents

// Mémoire partagée Overmind (pas la mémoire locale Hermes)
bridge.memorySearch({ query: 'trading' })
bridge.memoryStore({ text: 'Décision...', source: 'decision' })

// Agent CRUD
bridge.listAgents()
bridge.createAgent('nom', 'hermes', 'prompt')
bridge.deleteAgent('nom')

// Agent Control
bridge.agentControl({ agentName: 'x', action: 'status' })
bridge.agentControl({ agentName: 'x', action: 'kill' })

// Session persistante (Overmind, pas Hermes)
bridge.resetSession('agent')
```

### Circuit Breaker (BridgeProxy)

- **Closed** → tout passe, échecs comptés
- **Open** → après 5 échecs → bloque 30s
- **Half-Open** → 1 test, 3 succès → re-Close

### Session Persistante (Overmind)

```typescript
interface SessionState {
  currentSessionId: string | undefined;
  lastActivityAt: number;
  messageCount: number;
}
```
- Auto-persistée par le Bridge
- `autoResume: true` → reprend la session existante
- Survit entre les appels

---

## 🧠 Mémoire — 3 Couches

### 1. Mémoire Hermes Gateway (par agent, fichiers plats)

Injectée dans le prompt à chaque tour. Gérée par l'agent lui-même.

| Fichier | Rôle | Portée |
|---|---|---|
| `MEMORY.md` | Notes personnelles de l'agent | 1 agent |
| `USER.md` | Profil et préférences utilisateur | 1 agent |
| `state.db` | SQLite (sessions, cache skills) | 1 agent |

```bash
memory(action: "add", target: "memory", content: "L'utilisateur préfère...")
memory(action: "replace", target: "user", old_text: "old", content: "new")
```

### 2. Mémoire Overmind Locale (par agent, base de données)

**Chaque agent a sa PROPRE base de données Overmind** — isolation complète.
Les `memory_store` et `memory_search` sont **locale à l'agent** par défaut.

```bash
# Stockage local à l'agent (sa propre DB Overmind)
memory_store(text: "Décision : BlockChat v0.2", source: "decision")
memory_search(query: "BlockChat protocol")
```

- Chaque agent = sa propre DB vectorielle
- Recherche sémantique dans les connaissances de l'agent
- Types : `user`, `agent`, `pattern`, `error`, `decision`

### 3. Mémoire Overmind Partagée (entre agents)

En plus de sa DB locale, un agent peut accéder à une mémoire **commune** partagée entre tous les agents.

```bash
# Accès mémoire partagée (cross-agents)
memory_search(query: "trading strategy", include_runs: true)
```

- Partagée entre tous les agents de la flotte
- Inclut l'historique des runs (`include_runs: true`)
- Permet la transmission de connaissances inter-agents

---

## 🚀 Créer un Agent — Étape par Étape

### Via Overmind MCP (CRUD = Overmind)

```bash
# 1. Créer (Overmind)
create_agent(name: "mon_bot", runner: "hermes", prompt: "Tu es...")

# 2. Configurer (Overmind)
update_agent_config(name: "mon_bot", model: "glm-5.2",
  mcpServers: ["discord-server", "memory-server"])

# 3. Injecter clés (Overmind)
update_agent_config(name: "mon_bot", env: { "OPENAI_API_KEY": "sk-xxx" })

# 4. Lancer (Overmind orchestre, Hermes exécute)
run_agent(runner: "hermes", agentName: "mon_bot", prompt: "Analyse BTC")
```

### Via le Bridge SDK (TypeScript)

```typescript
import { OverBridgeService } from './bridge/index.js';

const bridge = new OverBridgeService(
  { mcpUrl: 'http://localhost:3099/mcp' },
  logger,
);

// Lancer un agent (Overmind → Hermes)
const reply = await bridge.runAgent('mon_bot', 'hermes', 'Analyse BTC');

// Avec contexte Discord
const reply = await bridge.runAgentForDiscord(
  'mon_bot', 'hermes', 'Analyse BTC',
  { channelId: '123', userId: '456', username: 'demon' }
);

// Multi-agents en parallèle (Overmind)
const results = await bridge.runParallel([
  { agentName: 'minimax_1', runner: 'hermes', prompt: 'Analyse marché' },
  { agentName: 'minimax_2', runner: 'hermes', prompt: 'Scrape Twitter' },
]);
```

---

## 🔗 Serveurs MCP — Outils des Agents

| Serveur MCP | Port | Ce qu'il fait |
|---|---|---|
| `discord-server` | 3141 | Messages, embeds, fichiers Discord |
| `memory-server` | 3099 | Mémoire locale/agent + partagée Overmind + CRUD agents |
| `postgresql-server` | 5433 | Base vectorielle (recherche sémantique) |
| `x-mcp-server` | 3142 | Scrape Twitter/X |

---

## 🏗️ Orchestration Multi-Agents (Overmind)

```
┌─────────────────────────────────┐
│        ORCHESTRATEUR            │
│      (Overmind wrapper)         │
│                                 │
│  ┌─────────┐  ┌─────────┐      │
│  │minimax_1│  │minimax_2│      │
│  │ Hermes  │  │ Hermes  │      │
│  └────┬────┘  └────┬────┘      │
│  ┌────┴────┐  ┌────┴────┐      │
│  │minimax_3│  │minimax_4│      │
│  │ Hermes  │  │ Hermes  │      │
│  └─────────┘  └─────────┘      │
│                                 │
│  → Embed Discord consolidé     │
└─────────────────────────────────┘
```

---

## ⚠️ Pièges à Éviter

1. **Confondre Hermes et Overmind** → Hermes = runtime agent, Overmind = encapsuleur
2. **Cron Hermes vs Cron Overmind** → Overmind est persistant, Hermes est par session
3. **3 couches de mémoire** → Fichiers plats (Hermes), DB locale/agent (Overmind), partagée cross-agents (Overmind)
4. **Clés API dans SOUL.md** → Jamais. Toujours dans `.env`
5. **Bridge sans session** → Toujours `autoResume: true` pour la continuité
6. **Oublier les MCP servers** → Sans MCP, l'agent ne peut rien faire

---

*Guide v3 par SniperBot Analyst — OverMind 🤖*
*Hermes Gateway vs Overmind clairement séparés + Bridge SDK*
