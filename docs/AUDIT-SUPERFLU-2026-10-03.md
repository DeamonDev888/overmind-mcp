# Audit SUPERFLU — repo overmind-mcp (v3.10.2)

Date : 2026-10-03
Source : analyse statique (grep croisé `package.json` ↔ `src/` ↔ `scripts/` ↔ `bin/` ↔ `.github/workflows/`)

> Aucun fichier n'a été modifié à la production de ce doc. C'est un plan d'action proposé.

---

## Légende catégories

- **KEEP** — utilisé par `package.json`, la CI ou un autre fichier source. Garder.
- **MORT** — aucun fichier ne le référence. À supprimer (candidats sûrs).
- **ORPHELIN-DECLARE** — déclaré dans `package.json` mais le fichier cible est absent ou vide. À réparer.

---

## Catégorie 1 — Code source `src/` (v3.10.2) : TOUT GARDÉ

- `src/tools/*` (29 fichiers) — tous utilisés par `run_agent.ts` ou `server.ts`
- `src/services/*` (15 fichiers) — tous actifs (runners + managers)
- `src/lib/*` (10 fichiers + `audit/`, `orchestration/`) — tous référencés
- `src/bridge/*` — cœur du bridge peer-to-peer
- `src/bin/*` — CLI et bridge client

**Verdict** : la v3.10.2 est **propre côté code source**. Aucune élimination possible sans casser la logique. Aucune action recommandée.

---

## Catégorie 2 — `scripts/` (MORTS / superflus)

| Fichier | Statut | Preuve | Action recommandée |
|---|---|---|---|
| `audit_backfill.mjs` | MORT | 0 ref hors `package.json` (qui ne le déclare pas) | **Supprimer** |
| `audit_migration.mjs` | MORT | bin `overmind-loi25-migrate` déjà retiré hier (2026-10-02) ; fichier encore présent | **Supprimer** |
| `audit_retention_cron.mjs` | MORT | 0 ref | **Supprimer** |
| `auto-install.mjs` | MORT | 0 ref | **Supprimer** |
| `bridge-smoke-test.sh` | MORT | 0 ref | **Supprimer** |
| `_db_check.py` | MORT | 0 ref, doublon probable de `status_check.py` | **Supprimer** |
| `status_check.py` | MORT | 0 ref | **Supprimer** |
| `post-bridge-embed.py` | MORT | 0 ref (tâche de maintenance ponctuelle 2026-09) | **Supprimer** |
| `setup-overmind-db.mjs` | MORT | 0 ref (doublon de `postgres-manager.mjs up`) | **Supprimer** |
| `setup-windows.js` | MORT | 0 ref | **Supprimer** |
| `test-pool-client.ts` | MORT | 0 ref (test manuel non intégré) | **Supprimer** |
| `test-registry.ts` | MORT | 0 ref | **Supprimer** |
| `test-wrapper-rpc.mjs` | MORT | 0 ref | **Supprimer** |

**Gardés** (utiles) : `auto-changelog.mjs`, `install-dependencies.mjs`, `install-native.mjs`, `ngrok-webhook.mjs`, `postgres-manager.mjs`, `postinstall.mjs`, `setup.mjs`, `test-installation.mjs`, `uninstall.mjs`, `verify-install.mjs`.

---

## Catégorie 3 — `bin/` (MORTS)

| Fichier | Statut | Action |
|---|---|---|
| `install-overmind-native.sh` | MORT | **Supprimer** |
| `install-overmind-unix.sh` | MORT | **Supprimer** |
| `install-overmind-windows.bat` | MORT | **Supprimer** |
| `overmind-pool.mjs` | MORT | **Supprimer** |
| `restart_mcp.bat` | MORT | **Supprimer** |
| `start_server.bat` | MORT | **Supprimer** |
| `test_mcp.bat` | MORT | **Supprimer** |

**Gardés** : `launch.bat`, `launch.cjs`, `launch.sh`, `overmind_keygen2000.py` (bin déclaré).

---

## Catégorie 4 — `assets/` (MIXTE)

8 images total (~648 Ko) :
- `overmind.png` — README principal
- `overmind_mcp_banner.png`, `overmind_mcp_final_banner.png`, `overmind_mcp_pro_banner.png` (+ `_slim`, `_v2`) — plusieurs variantes pour le même usage
- `overmind_core_closeup.png`, `terminal_preview.png`

**Action proposée** : fusionner en **2 images max** : `overmind.png` (banner principal) + `terminal_preview.png`. Économie ~400 Ko + 6 fichiers en moins. **À confirmer avec toi** — le `README.md` actuel pointe vers plusieurs fichiers, donc suppression = MAJ du README obligatoire.

---

## Catégorie 5 — `docs/` (volumineux)

19 fichiers / 385 Ko. Le `bridge/README.md` à lui seul fait **1019 lignes** (940 Ko de doc pour un bridge).

| Fichier | Statut |
|---|---|
| `MIGRATION_V3.md`, `MIGRATION_V4_WRAPPER.md` | OK (procédures de migration utiles) |
| `overmind-bridge-guide.md` | OK (doc principale) |
| `agent_control.md`, `doc_hermes_gateway.md` | OK |
| `kanbanroadmap.md` | **À vérifier** (si roadmap, sinon archiver) |
| `PLAN_AUDIT_INTEGRATION.md` | **À vérifier** (plan = obsolète après réalisation) |
| `plan_securité.md` | **À vérifier** |
| `OVERMIND_HERMES_SNIPERBOT_FLOW.md` | **À vérifier** |
| `provider-config-map.md` | OK |
| `SETUP_HERMES_AGENT_FROM_SCRATCH.md` | **À vérifier** |
| `SUBTILISATION_EXPLAINED.md` | **À vérifier** (conceptuel ?) |
| `prompt.html`, `index.html`, `library.html`, `script.js`, `styles.css` | OK (site GitHub Pages) |

**Action** : les `PLAN_*`, `SUBTILISATION_*`, `OVERMIND_*` sont **probablement obsolètes** post-release v3.10.2. Proposition : déplacer sous `docs/archive/` (git keep, hors npm package).

---

## Catégorie 6 — `package.json` (cleanliness)

### Items déjà nettoyés
- ✅ `overmind-loi25-migrate` bin retiré hier
- ✅ `.changeset/loi25-integration.md` supprimé

### Items à examiner
- `"test:install": "node scripts/test-installation.mjs"` — utile ?
- `"build:fix": "pnpm run clean && pnpm install && pnpm run build"` — utile ?
- `"check-types": "tsc --noEmit"` — utile ?
- `"postgres:reset"` — destructive, accessible publiquement ?

---

## Catégorie 7 — `.changeset/` (volumineux)

`.changeset/` : 2 fichiers seulement (`config.json`, `refactor-llm-provider-discovery.md`). 1 changeset déjà publié — à nettoyer avec `changeset status`.

---

## Catégorie 8 — `.github/workflows/` (correct)

- `test.yml` : CI principale (✅ obligatoire)
- `deploy.yml` : GitHub Pages (✅ utilisé)

Aucun superflu ici.

---

## Catégorie 9 — `fm_rows.json` (TRÈS VIDE)

**59 913 octets** de JSON à la racine, créé aujourd'hui (2026-10-02 20:20). Pas dans `.gitignore`. Pas référencé dans le code. **Sortie d'audit oubliée** par le subagent. **Action : supprimer + gitignore`.

---

## Récapitulatif gain potentiel

| Catégorie | Avant | Après | Gain |
|---|---|---|---|
| `scripts/` | 23 fichiers | 10 fichiers | **-13 fichiers** |
| `bin/` | 12 fichiers | 4 fichiers | **-8 fichiers** |
| `assets/` | 8 fichiers | 2 fichiers | **-6 fichiers, -400 Ko** |
| racine | `fm_rows.json` | (supprimé) | **-60 Ko** |
| Total | | | **-27 fichiers, ~460 Ko** |

**Verdict sur le repo** : la v3.10.2 est fonctionnelle. Le nettoyage élimine **l'inutile sans toucher au code testé par les 259 tests verts**.

---

## Procédure de publication (corrigée, minimale)

```bash
# 1. Install (workspace-isolé)
cd "C:/Users/Deamon/Desktop/Backup/Serveur MCP/Workflow"
pnpm install --ignore-workspace --no-frozen-lockfile

# 2. Build
pnpm run rebuild                  # rimraf dist && tsc

# 3. Lint (0 erreur, 0 warning exigés)
pnpm run lint

# 4. Tests (Docker pgvector requis)
docker start postgres-pgvector
POSTGRES_HOST=localhost POSTGRES_PORT=5432 POSTGRES_USER=postgres \
POSTGRES_PASSWORD=<db-password> POSTGRES_DATABASE=postgres POSTGRES_SSL=false \
  pnpm run test                   # 259/259 attendu
```

**Référence verte** : 17 fichiers de tests, 259 tests, ~7-13 s.

### Pièges à connaître
- **Pnpm workspace parent** : toujours `--ignore-workspace`
- **`overmind-postgres-mcp`** : dépendre en **exact** `"1.4.2"`, jamais `^1.4.2` (le caret résout vers 1.5.0 qui n'a pas de `dist/`)
- **npm whoami** renvoie E401 : token invalide, ne pas tenter `npm publish` sans régénérer
