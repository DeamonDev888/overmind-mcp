# Migration Overmind v4.0 — Wrapper Multi-Agent Persistant

> **Statut** : Plan de migration détaillé (4 phases)
> **Date** : 2026-07-10
> **Source** : v3.7.0 → v4.0.0
> **Pré-requis** : v3.7.0 publié (✅ en cours de pipeline)

---

## 🎯 Vision : pourquoi pivoter

### Le problème actuel (v3.7.0)

OverMind est positionné "orchestrateur universel" mais il fait 2 choses contradictoires :

1. **Wrapper multi-runner** (utile) — spawn Claude/Hermes/Kilo/Gemini, gère profils
2. **Couche d'orchestration centrale** (redondante avec Hermes) — dispatcher, kanban adapter, scenarios

La couche (2) réinvente des choses qu'Hermes fait **nativement** depuis la v0.13+ :
- Kanban natif (`hermes kanban`)
- Dispatcher (loop gateway 60s tick)
- Pool credentials avec rotation round-robin
- Sessions persistantes par profile

**Résultat** : 2 sources de vérité pour les mêmes concepts, dette technique, divergence de comportement.

### La cible (v4.0)

**OverMind = factory à agents persistants. Point.**

```
┌─────────────────────────────────────────────────────────────┐
│                  OVERMIND v4.0 WRAPPER                      │
│                                                              │
│   1 process FastMCP sur :3099 — pure factory                │
│                                                              │
│   In:  create_agent(name, prompt, model)                     │
│   Out: profil Hermes autonome + mémoire + state + skills     │
│                                                              │
│   Puis l'agent vit sa vie via:                              │
│   • run_agent (invoke direct)                                │
│   • a2a_hub (HTTP peer-to-peer)                              │
│   • bridge par-agent (1 port = 1 agent, peer-to-peer)        │
└─────────────────────────────────────────────────────────────┘
```

**Ce qui disparaît d'Overmind** (laissé à Hermes, sauf Kanban qui devient optionnel) :
- ❌ Kanban central → **`kanban_hub` MCP thin wrapper OPTIONNEL** (défaut OFF, opt-in via `OVERMIND_KANBAN_ENABLED=1`)
- ❌ Dispatcher → gateway loop natif
- ❌ ScenarioLoader → kanban pipeline natif (uniquement si Kanban activé)
- ❌ YOLO_CONFIG retry/circuit → dispatcher natif
- ❌ pgvector memory central → `memory.provider: postgres` dans chaque profil

**Ce qui reste d'Overmind** (son vrai rôle) :
- ✅ `create_agent` — thin wrapper sur `hermes profile create`
- ✅ `list_agents` / `delete_agent` / `update_agent_config` / `get_agent_configs`
- ✅ `run_agent` / `run_agents_parallel` — multi-runner (Claude, Kilo, etc.)
- ✅ `a2a_hub` — inter-agent HTTP (déjà peer-to-peer)
- ✅ `agent_control` — process lifecycle
- ✅ `memory_search` / `memory_store` — fallback pour les anciens clients
- 🔶 `kanban_hub` — **OPTIONNEL** (désactivé par défaut), uniquement si Kanban est dans le scope utilisateur

---

## 📐 Architecture cible

```
┌────────────────────────────────────────────────────────────────┐
│  v3.7.0 (actuel) — Orchestrateur central                       │
│                                                                  │
│  Client → MCP:3099 (Overmind) → orchestration/dispatcher         │
│                                    → KanbanAdapter               │
│                                       → ScenarioLoader           │
│                                          → HermesRunner spawn     │
└────────────────────────────────────────────────────────────────┘
                              ↓ REFACTOR ↓
┌────────────────────────────────────────────────────────────────┐
│  v4.0 (cible) — Wrapper factory                                 │
│                                                                  │
│  Client → MCP:3099 (Overmind factory)                           │
│             ├─ create_agent(name) → hermes profile create        │
│             ├─ run_agent(name) → HTTP :8642 + X-Hermes-Profile   │
│             ├─ a2a_hub → HTTP peer-to-peer                       │
│             └─ kanban_hub → hermes kanban CLI [OPTIONNEL]        │
│                                                                  │
│  Hermes Gateway (:8642, multi-profile)                           │
│  Hermes Pool (credentials natifs, rotation auto)                 │
└────────────────────────────────────────────────────────────────┘

> **Kanban est optionnel** : `kanban_hub` n'est exposé que si `OVERMIND_KANBAN_ENABLED=1`.
> Défaut = OFF pour rester minimaliste. Les utilisateurs qui n'en ont pas besoin
> ne tirent jamais la dépendance `hermes kanban` et n'ont pas la surface d'attaque.
```

### Différence conceptuelle clé

| Aspect | v3.7.0 orchestrateur | v4.0 wrapper |
|--------|----------------------|--------------|
| **Source of truth agents** | Overmind registry + db | Profils Hermes natifs (`~/.hermes/profiles/<name>/`) |
| **Source of truth state** | PostgreSQL central | `state.db` par profile (SQLite Hermes) |
| **Source of truth memory** | pgvector central | `memory.provider: postgres` par profile OU pgvector partagé en fallback |
| **Source of truth credentials** | `.env` par profile | Pool Hermes natif (`hermes auth add`) |
| **Source of truth workflows** | ScenarioLoader.json | Kanban Hermes |
| **Communication inter-agent** | Bridge central → RPC | HTTP peer-to-peer via bridge par-agent |
| **Échelle** | Limitée par le central | N agents, 1 process chacun, linéaire |

---

## 🗺️ Phases d'implémentation

### **Phase 1a — Audit & nettoyage minimal (semaine 1)** ⚡ OBLIGATOIRE

**Objectif** : supprimer le bloc `dispatcher + YOLO_CONFIG` (le seul vrai code d'orchestration custom). **Garde `KanbanAdapter.ts` et `ScenarioLoader.ts` intacts** pour ne rien casser aux utilisateurs Kanban existants.

#### 1a.1 Suppressions (SEULEMENT le couple dispatcher/YOLO)

| Fichier | LOC | Remplacé par | Risque |
|---------|-----|-------------|--------|
| `src/lib/orchestration/dispatcher.ts` | 283 | Gateway loop Hermes | Faible — seul `index.ts` + `run_agents_parallel.ts` |
| `YOLO_CONFIG` (inline) | ~50 | retry/circuit-breaker Hermes | Aucun — config isolée |

**Garde-fous** :
- `src/services/KanbanAdapter.ts` ← **CONSERVÉ** (utilisé si Kanban activé)
- `src/bridge/ScenarioLoader.ts` ← **CONSERVÉ** (utilisé si Kanban activé)

#### 1a.2 Étapes concrètes

```bash
# 1. Backup l'état actuel
git checkout -b chore/v4-phase1a-cleanup
git tag v3.7.0-baseline

# 2. Supprimer seulement dispatcher.ts et YOLO_CONFIG
rm src/lib/orchestration/dispatcher.ts
rmdir src/lib/orchestration
# Fix imports dans src/index.ts, src/tools/run_agents_parallel.ts
grep -r "YOLO" src/  # doit retourner 0 résultat

# 3. Build + tests
pnpm run rebuild && pnpm run test && pnpm run lint

# 4. Merge
git checkout main
git merge --no-ff chore/v4-phase1a-cleanup
git tag v4.0.0-phase1a
```

#### 1a.3 Critères de succès Phase 1a

| Métrique | Avant | Après |
|----------|-------|-------|
| Services files | 17 | 17 (inchangé — 0 suppression) |
| LOC total src/ | ~12,500 | ~12,200 (-300) |
| Concept "dispatcher" présent | 1 fichier | 0 |
| Tests passent | 68 | 68 |

---

### **Phase 1b — Suppression Kanban historique (semaine 1+) — OPTIONNEL**

> **Statut** : À faire **UNIQUEMENT** si on confirme via télémétrie/usage
> que personne n'utilise Kanban via Overmind (peu probable — Nexus l'utilise).
> Si Kanban est utilisé par ≥1 user → **sauter cette phase**, garder le code legacy.

**Pré-requis avant suppression** :
- ✅ Phase 2 livrée (`kanban_hub` MCP tool disponible)
- ✅ Au moins 1 release avec Kanban en opt-in sans régression
- ✅ Communication utilisateurs (CHANGELOG deprecation notice, 1 release de grâce)

Si OK pour suppression, déplacer `KanbanAdapter.ts` + `ScenarioLoader.ts` derrière le flag `OVERMIND_KANBAN_ENABLED=1` (déjà ce que fait Phase 2), puis supprimer après 1 release.

#### 1b.1 Suppressions conditionnelles

| Fichier | LOC | Remplacé par | Risque |
|---------|-----|-------------|--------|
| `src/services/KanbanAdapter.ts` | 420 | `tools/kanban_hub.ts` opt-in (Phase 2) | Moyen — utilisé par `index.ts`, `ScenarioLoader.ts` |
| `src/bridge/ScenarioLoader.ts` | 508 | `hermes kanban pipeline` | Moyen — utilisé par `overmind-bridge.ts` |

---

### **Phase 2 — Support Kanban OPTIONNEL (opt-in) (semaine 2)**

> **Statut** : À faire UNIQUEMENT si des utilisateurs demandent Kanban.
> Si personne ne l'utilise, sauter cette phase. Les autres phases (1, 3, 4) ne
> dépendent pas de Kanban.

**Opt-in** : `OVERMIND_KANBAN_ENABLED=1` dans `.env` (ou flag CLI `--with-kanban`).

**Objectif** : remplacer `KanbanAdapter` par 1 outil MCP unifié, conforme au pattern `a2a_hub` / `agent_control`. Uniquement chargé si activé.

#### 2.1 Spécification de l'outil

```typescript
// src/tools/kanban_hub.ts
import { z } from 'zod';

export const kanbanHubTool = {
  name: 'kanban_hub',
  description: `Hermes Kanban — manage tasks, boards and pipelines.
  Actions: init, create, list, show, update, complete, block, unblock,
           comment, assign, link, dispatch, stats, archive, boards, watch.`,
  inputSchema: z.object({
    action: z.enum([
      'init', 'create', 'list', 'show', 'update', 'complete',
      'block', 'unblock', 'comment', 'assign', 'link',
      'dispatch', 'stats', 'archive', 'boards', 'watch',
    ]),
    // Champs communs
    board: z.string().optional(),         // board name (multi-board)
    taskId: z.string().optional(),        // t_abc123
    // Champs spécifiques par action
    title: z.string().optional(),
    body: z.string().optional(),
    assignee: z.string().optional(),
    parents: z.array(z.string()).optional(),
    reason: z.string().optional(),
    status: z.enum(['pending', 'running', 'blocked', 'done', 'archived']).optional(),
    agentName: z.string().optional(),
    due: z.string().optional(),
    tags: z.array(z.string()).optional(),
  }),
  handler: async (args) => {
    // Wraps `hermes kanban <subcommand>` CLI
    return await HermesKanbanClient.execute(args);
  },
};
```

#### 2.2 Implémentation — `HermesKanbanClient`

```typescript
// src/services/HermesKanbanClient.ts
export class HermesKanbanClient {
  static async execute(args: KanbanArgs): Promise<KanbanResult> {
    const cmd = this.buildCommand(args);
    const { stdout, stderr } = await execAsync(cmd);
    return this.parseOutput(args.action, stdout, stderr);
  }

  static buildCommand(args: KanbanArgs): string {
    const sub = `${args.board ? `--board "${args.board}" ` : ''}${args.action}`;
    const flags = this.buildFlags(args);
    return `hermes kanban ${sub} ${flags}`.trim();
  }

  static parseOutput(action: string, stdout: string, stderr: string): KanbanResult {
    // Parse le format tabulaire d'`hermes kanban list/show`, JSON pour le reste
    return { success: !stderr, action, data: this.parseStructured(action, stdout) };
  }
}
```

#### 2.3 Migration des callers

| Caller actuel | Devient |
|--------------|---------|
| `index.ts` export de `kanbanAdapter` | Export de `HermesKanbanClient` |
| Appels directs `kanban.create(...)` | `kanban_hub({ action: 'create', ... })` |
| `ScenarioLoader.load(path)` | `kanban_hub({ action: 'load', path })` (futur) |

#### 2.4 Tests

- [ ] `kanban_hub({ action: 'list' })` retourne les tâches
- [ ] `kanban_hub({ action: 'create', title, assignee })` crée une tâche
- [ ] Erreurs explicites si `hermes kanban` CLI échoue
- [ ] Format de sortie cohérent avec les autres tools `*_hub`

#### 2.5 Critères de succès Phase 2

- [ ] `KanbanAdapter.ts` supprimé
- [ ] `tools/kanban_hub.ts` créé avec 16 actions
- [ ] Tests passent 68 → 75+
- [ ] `tools/list` montre 15 outils au lieu de 14 (+1 kanban_hub)

---

### **Phase 3 — Decentralized bridges + multi-profile gateway (semaine 3-4)**

**Objectif** : passer d'un `OverBridgeServer` centralisé à un bridge par agent (déjà documenté dans `overmind-bridge-guide.md` mais pas encore implémenté).

#### 3.1 État cible

```
Agent 1 = profil Hermes "alpha"
   ├─ hermes gateway --profile alpha --port 8742  (1 instance par agent)
   └─ overmind-bridge --agent alpha --port 3101

Agent 2 = profil Hermes "beta"
   ├─ hermes gateway --profile beta --port 8743
   └─ overmind-bridge --agent beta --port 3102
```

**OU** (variante multiplexing) : 1 seul gateway, routing par `X-Hermes-Profile` :
```
1 gateway process :8642
   ├─ profile alpha → sessions alpha
   └─ profile beta → sessions beta

overmind-bridge par-agent (3101, 3102)
   → POST http://127.0.0.1:8642/v1/chat/completions
   + header `X-Hermes-Profile: alpha`
```

#### 3.2 Work items

| Item | Effort | Dépendance |
|------|--------|-----------|
| `HermesGatewayManager.spawn(profile)` auto-start | 2h | Phase 1 ✅ |
| `HermesGatewayRunner` accepte `profile` option | 1h | — |
| Template `overmind-bridge-<agent>.ts` (peer-to-peer sans central) | 4h | Phase 1 ✅ |
| Suppression de `OverBridgeServer` (central) | 8h | Smoke test E2E réussi d'abord |
| `BridgeProxy` discovery service (trouve les peers par registry) | 3h | — |
| Refactor `a2a_hub` pour parler aux bridge ports (3101+) et plus au central | 4h | Découverte du peer |

#### 3.3 Stratégie d'exécution (crucial — éviter le Big Bang)

**Étape 1 — drapeau de feature**
```typescript
// src/lib/config.ts
process.env.OVERMIND_BRIDGE_MODE = 'centralized' | 'decentralized' | 'hybrid';
```

**Étape 2 — les deux modes coexistent**
- Mode A (`centralized`) : code actuel, default
- Mode B (`decentralized`) : nouveau, opt-in via env var
- Mode C (`hybrid`) : A pour les anciens agents, B pour les nouveaux

**Étape 3 — bascule progressive**
1. Déployer en `hybrid`
2. Migrer les 8 agents existants (Nexus Master, Trader, Healer, etc.) un par un
3. Quand tous sont migrés → flag = `decentralized` par défaut
4. Supprimer le code `centralized` (Phase 3 finale)

#### 3.4 Critères de succès Phase 3

- [ ] 1 bridge isolé par agent (8 agents = 8 bridges sur 3101-3108)
- [ ] A2A fonctionne entre bridges (peer-to-peer HTTP direct)
- [ ] Aucun agent ne dépend du `OverBridgeServer` central
- [ ] `OverBridgeServer` peut être supprimé sans casser les tests
- [ ] `pnpm run test` reste vert

---

### **Phase 4 — Mémoire par-profile (semaine 4-5)**

**Objectif** : chaque agent utilise son propre memory provider, au lieu du pgvector central.

#### 4.1 Le problème actuel

`PostgresMemoryProvider` est utilisé par :
- `tools/memory_search.ts` (MCP tool)
- `tools/memory_store.ts` (MCP tool)
- Auto-injecté à chaque agent via `mcp_servers: { memory: { url: :3099/mcp } }`

**Conséquence** : tous les agents partagent la même DB pgvector. Pas d'isolation mémoire entre agents. C'est exactement ce que le wrapper multi-agent persistant doit éviter.

#### 4.2 Solution

Hermes supporte `memory.provider` dans `config.yaml` (natif depuis v0.15+) :
```yaml
# config.yaml du profil
memory:
  provider: postgres
  postgres:
    url: postgresql://user:pass@localhost/memory_<profile_name>
```

Chaque agent a sa **propre DB**, nommée d'après le profil.

#### 4.3 Étapes

```typescript
// src/services/HermesProfileManager.ts — ajout méthode
static async setMemoryProvider(
  name: string,
  opts: { provider: 'postgres' | 'sqlite' | 'file'; url?: string } = { provider: 'sqlite' },
): Promise<void> {
  // 1. Si postgres, créer DB dédiée
  if (opts.provider === 'postgres' && !opts.url) {
    const dbName = `overmind_memory_${name}`;
    await PostgresAdmin.createDatabase(dbName);
    opts.url = `postgresql://${process.env.PG_USER}:${process.env.PG_PASS}@localhost/${dbName}`;
  }

  // 2. hermes -p <name> config set memory.provider <provider>
  await execAsync(`hermes -p "${name}" config set memory.provider "${opts.provider}"`);
  if (opts.url) {
    await execAsync(`hermes -p "${name}" config set memory.postgres.url "${opts.url}"`);
  }
}
```

#### 4.4 Compatibilité ascendante

`memory_search` / `memory_store` MCP tools restent mais deviennent **passerelles** :
- Si l'agent appelant a `memory.provider` → query sa DB
- Sinon → fallback pgvector central (legacy)

```typescript
// src/tools/memory_search.ts
handler: async (args) => {
  const callerAgent = getCallerAgent();
  if (callerAgent?.memoryProvider === 'postgres') {
    return await queryAgentMemory(callerAgent, args);
  }
  // Legacy fallback
  return await getMemoryProvider().search(args);
};
```

#### 4.5 Critères de succès Phase 4

- [ ] `HermesProfileManager.setMemoryProvider()` fonctionne
- [ ] Chaque agent a sa propre DB
- [ ] `memory_search` retourne des résultats **propres à l'agent** (pas de pollution croisée)
- [ ] Test E2E : `agent_a` stocke "secret-X", `agent_b` ne le voit pas
- [ ] `PostgresMemoryProvider` reste pour le fallback legacy mais marqué deprecated

---

## 🔬 Plan de tests de régression

À exécuter **après chaque phase** :

### Smoke test (5 min)

```bash
# 1. Build + lint + tests
pnpm run rebuild && pnpm run lint && pnpm run test

# 2. E2E manuel via MCP
overmind --transport httpStream --port 3099 &
sleep 3

# 3. Créer un agent via MCP tool
curl -X POST http://localhost:3099/mcp \
  -d '{"jsonrpc":"2.0","method":"tools/call","params":{"name":"create_agent","arguments":{"name":"smoke_test_$(date +%s)","runner":"hermes","model":"glm-4.6","prompt":"You are a smoke test agent"}},"id":1}'

# 4. Lui poser une question
curl -X POST http://localhost:3099/mcp \
  -d '{"jsonrpc":"2.0","method":"tools/call","params":{"name":"run_hermes","arguments":{"agentName":"<created>","prompt":"Reply: SMOKE_OK"}},"id":2}'

# 5. Cleanup
curl -X POST http://localhost:3099/mcp \
  -d '{"jsonrpc":"2.0","method":"tools/call","params":{"name":"delete_agent","arguments":{"name":"<created>"}},"id":3}'
```

### Tests unitaires à préserver/ajouter

| Phase | Tests à préserver | Tests à ajouter |
|-------|------------------|-----------------|
| **Phase 1** | 68 existants | 0 (que suppressions) |
| **Phase 2** | 68 | +8 `HermesKanbanClient` |
| **Phase 3** | 76 | +12 `BridgeProxy` discovery |
| **Phase 4** | 88 | +10 `memoryProvider` isolation |

---

## 📅 Timeline globale

| Semaine | Phase | Livrable | Version |
|---------|-------|----------|---------|
| 1 | Phase 1a — Nettoyage dispatcher/YOLO (obligatoire) | -300 LOC, 1 fichier | v4.0.0-alpha |
| 2 | Phase 2 — Support Kanban OPTIONNEL *(si demandé)* | +1 tool chargé opt-in | v4.0.0-beta |
| 3-4 | Phase 3 — Decentralized bridges + multi-profile gateway | 1 bridge/agent | v4.0.0-rc |
| 4-5 | Phase 4 — Mémoire par-profile | isolation mémoire | v4.0.0 |
| quand prêt | Phase 1b — Suppression Kanban historique *(opt-in après 1 release grâce)* | -930 LOC | v4.1.0 |

> **Note** : Phase 2 est conditionnelle. Si Kanban n'est pas dans le scope,
> on peut release v4.0.0 final après la Phase 3 + Phase 4 sans Phase 2.

---

## ⚠️ Risques identifiés

| Risque | Impact | Mitigation |
|--------|--------|-----------|
| **Rétro-compat callers KanbanAdapter** | Élevé — utilisé par 4 fichiers | Wrapper compat pendant 1 release, déprecation warning |
| **Migration DB pgvector** | Élevé — données existantes | Dual-write 1 release, outil de migration `pnpm run migrate:memory:v4` |
| **OverBridgeServer supprimé trop tôt** | Élevé — bridge central = SPOF | Feature flag `OVERMIND_BRIDGE_MODE`, bascule progressive |
| **Hermes API change** (versions futures) | Moyen — pool gateway déjà adapté | Pin Hermes version dans `setup.mjs`, tests d'intégration |

---

## 🤝 Décisions à prendre avant de commencer

1. **Maintenir `OverBridgeServer` central en parallèle** ? Oui, le temps de la migration
2. **Migration auto des agents existants** ? Oui — script `migrate-agents-v4.ts`
3. **Deprecation warnings ou rupture nette** ? Deprecation 2 releases (v4.0 + v4.1)
4. **Documentation site web** : régénérer `docs/index.html` avec nouvelle vision

---

## 📚 Annexes

### A. Inventaire des fichiers (split obligatoire / optionnel)

**OBLIGATOIRE (Phase 1a)** :
```
src/lib/orchestration/dispatcher.ts         (283 LOC)  ← SUPPRIMER
src/lib/orchestration/                     (dossier)    ← SUPPRIMER
YOLO_CONFIG (inline dans KanbanAdapter)    (~50 LOC)    ← SUPPRIMER
```

**OPTIONNEL — conservé tant que Kanban est utilisé** :
```
src/services/KanbanAdapter.ts              (420 LOC)    ← CONSERVÉ
src/bridge/ScenarioLoader.ts               (508 LOC)    ← CONSERVÉ
```

**Suppression totale si Kanban confirmé inutilisé (Phase 1b)** :
```
src/services/KanbanAdapter.ts              (420 LOC)    ← SUPPRIMER (v4.1.0)
src/bridge/ScenarioLoader.ts               (508 LOC)    ← SUPPRIMER (v4.1.0)
```

### B. Inventaire des fichiers à créer (tous OPTIONNELS sauf ceux de Phase 3-4)

```
# OPTIONNEL (Phase 2 — opt-in Kanban)
src/tools/kanban_hub.ts                    (NOUVEAU — 250 LOC) [chargé si OVERMIND_KANBAN_ENABLED=1]
src/services/HermesKanbanClient.ts         (NOUVEAU — 180 LOC) [chargé opt-in]
src/tools/kanban_hub.test.ts               (NOUVEAU — 200 LOC, 8 tests) [opt-in]

# OBLIGATOIRE (Phase 3-4 — wrapper pur)
src/bridge/BridgeProxy.ts                  (NOUVEAU — 150 LOC)
src/services/HermesProfileManager.setMemoryProvider  (méthode ajoutée)
scripts/migrate-agents-v4.ts              (NOUVEAU — 100 LOC)
docs/MIGRATION_V4_WRAPPER.md              (CE DOCUMENT — déjà créé)
```

### C. Checklist pre-merge

- [ ] Tous les tests passent (`pnpm run test`)
- [ ] Lint clean (`pnpm run lint`)
- [ ] Build compile (`pnpm run rebuild`)
- [ ] Smoke test E2E réussi
- [ ] Documentation à jour (`docs/`, `README.md`)
- [ ] CHANGELOG.md mis à jour
- [ ] Tag git posé

---

_Migration planifiée par DeaMoN888 — 2026-07-10_
