# Plan de Migration — Overmind Hermes v2 → v3.0 (Native Profiles)

> **Objectif** : Migrer les 6 anciens agents Hermes du layout Overmind custom vers les profils Hermes natifs (`~/.hermes/profiles/<name>/`), puis appliquer le modèle kanban (PostgreSQL 18 registry + SQLite state local + homes standardisés).

---

## Inventaire des agents à migrer

### Agents Hermes (layout Overmind custom → profils natifs)

| # | Agent | Modèle | Provider | MCP | SOUL.md | Statut |
|---|-------|--------|----------|-----|---------|--------|
| 1 | `sniperbot_analyst` | MiniMax-M3 | minimax-cn | 3 | 4278b | ✅ **DÉJÀ MIGRÉ** |
| 2 | `tradingview_analyst` | MiniMax-M3 | minimax-cn | 9 | 5170b | ⬜ À migrer |
| 3 | `pdf_bon_travail` | MiniMax-M3 | minimax-cn | 3 | 0b* | ⬜ À migrer |
| 4 | `test_hermes_runner` | MiniMax-M3 | minimax-cn | 2 | 2699b | ⬜ À migrer (test) |
| 5 | `hermes_test_validation` | MiniMax-M3 | minimax-cn | 3 | 2528b | ⬜ À migrer (test) |
| 6 | `hermes_test_validation_agent` | claude-sonnet-4-6 | minimax-cn* | 8 | 2545b | ⬜ À migrer (test) |

*pdf_bon_travail n'a pas de SOUL.md dans le layout Overmind, mais en a un (4283b) dans `~/.hermes/agents/`.
*hermes_test_validation_agent a model=claude-sonnet-4-6 mais provider=minimax-cn → mismatch à corriger.

### Agents Claude/Kilo (NON affectés)

91 agents dans `.claude/agents/*.md` — **aucune migration nécessaire**. Ils restent dans le layout Overmind existant.

---

## Phase 0 — Sauvegarde (préalable)

```bash
# Backup complet du dossier .overmind/hermes (ancien layout)
cp -r ".overmind/hermes" ".overmind/hermes.backup.$(date +%Y%m%d)"

# Backup des profils Hermes actuels
cp -r "$LOCALAPPDATA/hermes/profiles" "$LOCALAPPDATA/hermes/profiles.backup.$(date +%Y%m%d)"

# Backup du registry PostgreSQL
pg_dump -h localhost -p 5432 overmind_registry > "overmind_registry_backup_$(date +%Y%m%d).sql"
```

---

## Phase 1 — Migration des agents (4 étapes par agent)

Pour chaque agent de la liste ci-dessus (sauf sniperbot_analyst déjà fait):

### Étape 1: Créer le profil natif

```bash
hermes profile create <name> --no-alias --description "<description from SOUL.md>"
hermes -p <name> config set model.provider <provider>
hermes -p <name> config set model.model <model>
```

### Étape 2: Copier les fichiers

```bash
# SOUL.md (system prompt)
cp ".overmind/hermes/agents/<name>/SOUL.md" \
   "$LOCALAPPDATA/hermes/profiles/<name>/SOUL.md"

# .env (credentials — extraits de settings.json)
# Les clés sont mappées selon le provider:
#   sk-cp-* → MINIMAX_CN_API_KEY
#   32hex   → GLM_API_KEY
#   sk-ant-* → ANTHROPIC_API_KEY
```

### Étape 3: Configurer les MCP servers

Le `HermesProfileManager.setMcpServers()` lit automatiquement le `.mcp.json` du workspace et écrit les vraies URLs dans le `config.yaml` du profil.

```bash
# Vérifier
hermes -p <name> mcp list
```

### Étape 4: Valider

```bash
# Test basique
hermes -p <name> chat -q "Reply with: <NAME> OK" -Q --yolo

# Test MCP tools
hermes -p <name> chat -q "List all mcp_ tools available" -Q --yolo
```

---

## Phase 2 — Ordre de migration (par priorité)

### Priorité 1: Production agents

1. **tradingview_analyst** — 9 MCP servers, SOUL.md complet
   - Provider: minimax-cn
   - MCPs: memory, discord, postgres, + 6 autres
   - Action: migration complète + test MCP

2. **pdf_bon_travail** — 3 MCP servers
   - Provider: minimax-cn
   - SOUL.md: récupérer depuis `~/.hermes/agents/pdf_bon_travail/SOUL.md` (4283b)
   - Action: fusionner les deux sources (Overmind + ~/.hermes)

### Priorité 2: Test agents (optionnel)

3. **test_hermes_runner** — agent de test
4. **hermes_test_validation** — agent de test
5. **hermes_test_validation_agent** — agent de test (corriger provider mismatch)

### Priorité 3: Cleanup

6. Supprimer les profils de test après validation
7. Archiver le dossier `.overmind/hermes/` (ne pas supprimer immédiatement)

---

## Phase 3 — Script de migration automatique

Le script `scripts/migrate-to-profiles.mjs` automatise toute la Phase 1:

```bash
# Dry-run (voir ce qui serait fait)
node scripts/migrate-to-profiles.mjs --dry-run

# Migration réelle
node scripts/migrate-to-profiles.mjs
```

Le script:
1. Scanne `.overmind/hermes/agents/*/settings.json`
2. Pour chaque agent:
   - Détecte le provider depuis le token prefix
   - Crée le profil via `hermes profile create`
   - Configure model + provider via `hermes config set`
   - Copie SOUL.md
   - Écrit .env avec les bonnes clés provider
   - Configure les MCP servers depuis .mcp.json
3. Affiche le résumé

---

## Phase 4 — Registry PostgreSQL (model kanban)

Après la migration des agents, créer le registry central dans PostgreSQL 18:

### Schema `overmind_registry`

```sql
CREATE SCHEMA IF NOT EXISTS overmind_registry;

-- Table: agents (registre canonique)
CREATE TABLE overmind_registry.agents (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name        TEXT UNIQUE NOT NULL,
    runner      TEXT NOT NULL DEFAULT 'hermes',
    profile_path TEXT,
    model       TEXT,
    provider    TEXT,
    description TEXT,
    mcp_servers TEXT[],
    status      TEXT DEFAULT 'active',  -- active | archived | deprecated
    created_at  TIMESTAMPTZ DEFAULT now(),
    updated_at  TIMESTAMPTZ DEFAULT now()
);

-- Table: profiles (mapping profil Hermes → agent Overmind)
CREATE TABLE overmind_registry.profiles (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    agent_id    UUID REFERENCES overmind_registry.agents(id) ON DELETE CASCADE,
    profile_name TEXT UNIQUE NOT NULL,
    home_path   TEXT NOT NULL,
    soUL_hash   TEXT,
    config_hash TEXT,
    created_at  TIMESTAMPTZ DEFAULT now()
);

-- Table: workspaces (workspace typés)
CREATE TABLE overmind_registry.workspaces (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    agent_id    UUID REFERENCES overmind_registry.agents(id),
    kind        TEXT NOT NULL,  -- scratch | dir | worktree
    path        TEXT NOT NULL,
    tenant      TEXT,
    created_at  TIMESTAMPTZ DEFAULT now(),
    archived_at TIMESTAMPTZ
);

-- Table: gc_log (garbage collection déterministe)
CREATE TABLE overmind_registry.gc_log (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    action      TEXT NOT NULL,  -- prune | archive | delete
    target      TEXT NOT NULL,
    reason      TEXT,
    ts          TIMESTAMPTZ DEFAULT now()
);
```

### Migration des données

```sql
-- Insérer les agents migrés
INSERT INTO overmind_registry.agents (name, runner, profile_path, model, provider, description)
VALUES
    ('sniperbot_analyst', 'hermes', '~/.hermes/profiles/sniperbot_analyst', 'MiniMax-M3', 'minimax-cn', 'Discord assistant + Overmind orchestrator'),
    ('tradingview_analyst', 'hermes', '~/.hermes/profiles/tradingview_analyst', 'MiniMax-M3', 'minimax-cn', 'TradingView analysis agent'),
    ('pdf_bon_travail', 'hermes', '~/.hermes/profiles/pdf_bon_travail', 'MiniMax-M3', 'minimax-cn', 'PDF work order management');
```

---

## Phase 5 — Standardisation des homes

Chaque profil doit avoir une structure standardisée:

```
~/.hermes/profiles/<name>/
├── config.yaml          ← provider + model + mcp_servers
├── .env                 ← credentials (1 set par profil)
├── SOUL.md              ← system prompt
├── profile.yaml         ← description (pour kanban routing)
├── memories/            ← state.db (SQLite runtime)
├── sessions/            ← historique conversations
├── skills/              ← skills du profil
├── cron/                ← jobs programmés
├── workspace.yaml       ← NEW: workspace config (kind, path, tenant)
└── README.md            ← NEW: doc du profil
```

### workspace.yaml (nouveau)

```yaml
# Workspace configuration for <name>
kind: dir                    # scratch | dir | worktree
path: ~/.hermes/profiles/<name>/workspace
tenant: default              # tenant namespace
auto_clean: false            # GC auto pour scratch only
```

### README.md (nouveau)

```markdown
# <name>

**Runner:** hermes
**Model:** MiniMax-M3 (minimax-cn)
**MCP servers:** memory, discord, postgres, tradingview

## Description
<from SOUL.md first paragraph>

## MCP Tools
- mcp_postgres_* — PostgreSQL queries
- mcp_discord_* — Discord messaging
- mcp_tradingview_* — TradingView analysis

## Credentials
Credentials are in `.env` (not committed).

## Migration
Migrated from Overmind v2 custom layout on 2026-06-28.
Original: .overmind/hermes/agents/<name>/
```

---

## Phase 6 — Symlinks rétrocompat

Pour ne pas casser les scripts existants qui référencent l'ancien layout:

```bash
# Pour chaque agent migré, créer un symlink:
ln -s "$LOCALAPPDATA/hermes/profiles/<name>" \
      ".overmind/hermes/agents/<name>"

# Les anciens chemins pointent maintenant vers le profil natif.
# Au prochain cycle de dev, on supprimera progressivement les symlinks.
```

---

## Checklist de validation

### Par agent

- [ ] Profil créé: `hermes profile list` le montre
- [ ] config.yaml: provider + model corrects
- [ ] .env: credentials présents et valides
- [ ] SOUL.md: copié intégralement
- [ ] MCP servers: `hermes -p <name> mcp list` les montre
- [ ] Test basic: `hermes -p <name> chat -q "test" -Q --yolo` répond
- [ ] Test MCP: agent peut utiliser mcp_postgres_explore
- [ ] Test Overmind: `run_agent(runner: "hermes", agentName: "<name>")` répond

### Global

- [ ] Tous les agents Hermes migrés vers profils natifs
- [ ] `hermes profile list` montre tous les agents
- [ ] `list_agents` MCP tool les montre tous
- [ ] Registry PostgreSQL créé avec le bon schema
- [ ] Agents enregistrés dans overmind_registry.agents
- [ ] Symlinks rétrocompat en place
- [ ] Ancien layout archivé (pas supprimé)
- [ ] Bot Discord (sniperbot_analyst) fonctionne toujours

---

## Rollback

Si la migration échoue:

```bash
# 1. Restaurer les profils backup
cp -r "$LOCALAPPDATA/hermes/profiles.backup.YYYYMMDD/*" "$LOCALAPPDATA/hermes/profiles/"

# 2. Restaurer l'ancien layout
cp -r ".overmind/hermes.backup.YYYYMMDD" ".overmind/hermes"

# 3. Restaurer le registry PostgreSQL
psql -h localhost -p 5432 overmind_registry < "overmind_registry_backup_YYYYMMDD.sql"

# 4. Redémarrer le MCP server
kill $(netstat -ano | grep ":3099.*LISTENING" | awk '{print $5}')
cd Workflow && node dist/bin/cli.js --transport httpStream --port 3099
```

---

## Timeline estimée

| Phase | Durée | Downtime |
|-------|-------|----------|
| Phase 0: Sauvegarde | 15min | 0 |
| Phase 1: Migration agents (3 prod) | 1h | ~5min/agent |
| Phase 2: Script auto + tests | 30min | 0 |
| Phase 3: Registry PostgreSQL | 1h | 0 |
| Phase 4: Standardisation homes | 2h | 0 |
| Phase 5: Symlinks rétrocompat | 30min | 0 |
| **Total** | **~5h** | **~15min** |
