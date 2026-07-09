# Kanban Roadmap — Overmind v4.0 (FUTURE)

> Statut: **DRAFT** — pas implémenté. Sauvegardé comme roadmap possible.
> Date: 2026-07-08

## Vision

Overmind devient l'orchestrateur. Hermes Gateway devient le backbone d'exécution.
Le Kanban Hermes est exposé via MCP comme **UN SEUL outil** `kanban_hub` (pas 15 outils séparés).

## Architecture cible

```
OVERMIND MCP (:3099)          → Management + Orchestration
  └─ kanban_hub (1 tool MCP)  → Wrappe `hermes kanban` CLI
  └─ a2a_hub (1 tool MCP)     → Communication inter-workers
  └─ run_agent, memory_*, etc → Multi-runner + PostgreSQL

HERMES GATEWAY (backbone)     → Execution engine natif
  └─ Dispatcher (tick 60s)
  └─ Kanban board (kanban.db)
  └─ 9 kanban_* tools (injectés aux workers)
  └─ Dashboard + /kanban slash
  └─ Remote gateway (OAuth)
```

## Outil MCP unique: `kanban_hub`

UN SEUL outil MCP avec `action` enum (comme `a2a_hub` et `agent_control`):

```typescript
kanban_hub({
  action: "create",       // create|list|show|complete|block|unblock|comment|link|dispatch|stats|archive|boards|watch|init
  title: "...",           // pour create
  assignee: "sniperbot",  // pour create
  taskId: "t_abc123",     // pour show/complete/block/unblock/comment/archive
  body: "...",            // pour create/comment
  parents: ["t_001"],     // pour create (dependencies)
  reason: "...",          // pour block
  status: "running",      // pour list (filter)
  board: "my-project",    // multi-board
  // ... etc
})
```

Avantages d'un seul outil:
- Schema compact (1 entrée dans tools/list au lieu de 15)
- L'agent découvre toutes les actions dans la description
- Pattern identique à a2a_hub et agent_control (cohérent)
- Moins de pollution du context window de l'agent

## Ce qui serait supprimé d'Overmind (redondant)

| Fichier | Raison |
|---------|--------|
| `src/services/KanbanAdapter.ts` (420 lignes) | Remplacé par `kanban_hub` MCP tool |
| `src/lib/orchestration/dispatcher.ts` | Gateway dispatcher natif |
| `src/bridge/ScenarioLoader.ts` (17KB) | Kanban pipeline + decompose natif |
| YOLO_CONFIG | Retry/circuit-breaker natifs du dispatcher |

## Ce qui reste dans Overmind (son vrai rôle wrapper)

- `run_agent` — Multi-runner spawn direct (Mode A)
- `create_agent` / `list_agents` / `delete_agent` / `update_agent_config`
- `memory_search` / `memory_store` / `memory_runs` — PostgreSQL vector
- `agent_control` — Process lifecycle
- `a2a_hub` — Communication inter-workers HTTP
- `kanban_hub` — Wrap Kanban Hermes (NOUVEAU, futur)
- `config_example` / `create_prompt` / `edit_prompt`
- `run_agents_parallel` — Pour runners non-Hermes

## Phases d'implémentation (futur)

### Phase 1 — Nettoyage
- Supprimer KanbanAdapter.ts, dispatcher.ts, ScenarioLoader.ts
- Nettoyer imports
- Build + test

### Phase 2 — Outil `kanban_hub` MCP unique
- Créer `src/tools/kanban_hub.ts`
- 1 schéma Zod avec `action` enum
- Chaque action appelle `hermes kanban <verb>` via CLI
- Enregistrer dans server.ts
- Build + lint + test

### Phase 3 — Gateway lifecycle
- `gateway_control` intégré à `agent_control` (action: "gateway_start/stop/status")
- Modifier install-overmind-native.sh pour démarrer gateway
- systemd service inclut `hermes gateway start`

### Phase 4 — Install scripts
- postinstall.mjs détecte Hermes, propose install
- verify-install.mjs vérifie gateway + kanban.db

### Phase 5 — Remote Gateway
- Documenter Desktop → Server Gateway (OAuth)
- `docs/REMOTE_GATEWAY.md`

### Phase 6 — A2A + Kanban fusion
- a2a_hub utilise kanban_create comme fallback durable
- Si worker HTTP injoignable → tâche kanban

## Prérequis

- Hermes Agent installé sur le serveur (`pip install hermes-agent` ou `hermes setup`)
- `hermes gateway start` fonctionnel
- `~/.hermes/kanban.db` accessible (symlink ~/.hermes → ~/.overmind/hermes)
- Hermes v0.18.1+ (Kanban v1 complet)
