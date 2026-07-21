# Plan d'intégration Loi 25 — Overmind-MCP

> **Version** : 1.1 (décisions périmètre validées)
> **Date** : 21 juillet 2026
> **Statut** : ✅ Périmètre validé — prêt à coder
> **Cible** : overmind-mcp v3.9.0
>
> **Décisions validées** :
> - **Périmètre RP** : Mixte — consentement explicite (tiers externes) + intérêt légitime (usage interne)
> - **Transferts hors QC** : Documentation seule, aucun blocage de providers
> - **Rétention** : 30 jours par défaut pour tout, option de backup/archivage 5 ans
> - **Activation** : Flag `OVERMIND_LOI25_ENABLED=true` dans `.env` (désactivé = pas de garde)

---

## 1. Contexte

L'Overmind est un **responsable de traitement** au sens de la Loi 25 (Loi moderneisant
des dispositions législatives en matière de protection des renseignements personnels).
Il collecte, stocke et transfère des renseignements personnels (RP) via :

- **Mémoire PostgreSQL/pgvector** : `agent_runs` (prompts/résultats), `knowledge_chunks` (texte + embeddings)
- **8 runners LLM externes** : Claude, Gemini, Kilo, QwenCLI, OpenClaw, Cline, OpenCode, Hermes
- **Bridge Discord** : messages utilisateurs → LLM
- **Profils Hermes** : `.env` (credentials), `SOUL.md` (personas), `state.db` (SQLite local)

La conformité Loi 25 n'est pas optionnelle : la CAI a publié son cadre d'application
des SAP en septembre 2023, et une vague d'application est imminente (2026-2027).

## 2. Articles Loi 25 applicables (matrice de conformité)

| Article | Obligation | État Overmind | Priorité |
|---|---|---|---|
| **3-3.1** | RPRP désigné + reddition de comptes | ❌ Aucun | P0 |
| **3.5-3.8** | Notification d'incident (CAI + personnes) | ❌ Aucun | P0 |
| **4** | Finalité légitime + collecte pertinente | ⚠️ Implicite | P1 |
| **8.1-8.2** | Consentement (libre, éclairé, spécifique) | ❌ Aucun | P0 |
| **12.1** | Évaluation de l'atteinte (échelle de gravité) | ❌ Aucun | P1 |
| **14-17.3** | Droits : accès, rectification, opposition, notification | ❌ Aucun | P0 |
| **18.1** | EFVP (évaluation facteurs vie privée) pour nouveaux projets | ❌ Aucun | P1 |
| **21-22** | Transferts hors Québec (documentation + garanties) | ❌ Aucun | P0 |
| **23.1** | Anonymisation (technique, non-réidentification) | ❌ Aucun | P1 |
| **26** | Droit d'accès (confirmation + communication) | ❌ Aucun | P0 |
| **27** | Droit de rectification | ❌ Aucun | P1 |
| **35.2-35.3** | Conservation et destruction des RP | ❌ Aucune rétention | P0 |
| **35.18** | Registre des traitements / politique de confidentialité | ❌ Aucun | P0 |

## 3. Architecture cible — Privacy by Design

```
                        ┌─────────────────────────────────────────┐
                        │   Overmind MCP (FastMCP, 16 outils)     │
                        │                                          │
   Requête ──────────▶ │  ┌────────────────────────────────────┐ │
   (prompt +            │  │  🛡️ LOI25 GUARD (middleware)        │ │
    data_subject_id +   │  │  • Capture legal_basis             │ │
    legal_basis)        │  │  • Valide consentement             │ │
                        │  │  • Hash/anonymise si requis        │ │
                        │  │  • Log transfert hors QC           │ │
                        │  │  • Check rétention                 │ │
                        │  └─────────────┬──────────────────────┘ │
                        │                │                         │
                        │    ┌───────────┼───────────┐             │
                        │    ▼           ▼           ▼             │
                        │  Runner    Memory     A2A Hub            │
                        │  (8 LLM)   (PG/vec)   (bridges)          │
                        └────┬──────────┬──────────┬───────────────┘
                             │          │          │
                    ┌────────▼──────────▼──────────▼──────────────┐
                    │  📋 LOI25 DATA LAYER (nouveau)               │
                    │  • consent_records                          │
                    │  • data_subjects (registre)                 │
                    │  • processing_registry                      │
                    │  • incident_log                             │
                    │  • access_log                               │
                    │  • retention_policies                       │
                    │  • transfer_log (hors QC)                   │
                    └─────────────────────────────────────────────┘
```

## 4. Plan d'intégration — 8 axes, 4 phases

### Phase 1 — Fondations (P0, fondement légal)

**Objectif** : rendre l'Overmind capable de répondre aux droits d'accès, d'effacement
et de reddition de comptes.

#### 1.1 Schema DB — Gouvernance des RP

**Modifier** `src/memory/PostgresMemoryProvider.ts` (initialisation des tables) :

```sql
-- Extensions de agent_runs
ALTER TABLE agent_runs ADD COLUMN IF NOT EXISTS
  data_subject_id TEXT,           -- identifiant pseudonymisé de la personne
  legal_basis TEXT,               -- 'consent' | 'contract' | 'legitimate_interest' | 'legal_obligation'
  consent_ref TEXT,               -- FK vers consent_records.id
  retention_expires_at BIGINT,    -- timestamp d'expiration (art. 35.2)
  anonymized INTEGER DEFAULT 0,   -- 1 si anonymisé (art. 23.1)
  created_for TEXT;               -- finalité (art. 4)

-- Extensions de knowledge_chunks
ALTER TABLE knowledge_chunks ADD COLUMN IF NOT EXISTS
  data_subject_id TEXT,
  legal_basis TEXT,
  consent_ref TEXT,
  retention_expires_at BIGINT,
  anonymized INTEGER DEFAULT 0;
```

**Nouvelles tables** (migration `scripts/loi25_migration.mjs`) :

```sql
CREATE TABLE IF NOT EXISTS data_subjects (
  id TEXT PRIMARY KEY,             -- UUID pseudonymisé (jamais l'identité brute)
  display_name TEXT,               -- étiquette optionnelle (ex: "user_discord_123")
  source TEXT,                     -- 'discord' | 'api' | 'manual'
  created_at BIGINT,
  metadata JSONB                   -- infos non-RP (compteur de requêtes, etc.)
);

CREATE TABLE IF NOT EXISTS consent_records (
  id TEXT PRIMARY KEY,
  data_subject_id TEXT NOT NULL,
  purpose TEXT NOT NULL,           -- 'agent_execution' | 'memory_storage' | 'embedding'
  legal_basis TEXT NOT NULL,
  granted_at BIGINT,
  expires_at BIGINT,               -- consentement peut expirer
  withdrawn_at BIGINT,             -- null si actif
  evidence TEXT,                   -- hash du message/source de consentement
  FOREIGN KEY (data_subject_id) REFERENCES data_subjects(id)
);

CREATE TABLE IF NOT EXISTS processing_registry (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,              -- 'agent_run_storage' | 'embedding_generation'
  purpose TEXT NOT NULL,
  legal_basis TEXT NOT NULL,
  data_categories TEXT,            -- 'prompts' | 'embeddings' | 'discord_messages'
  recipients TEXT,                 -- providers LLM, vector DB
  retention_days INTEGER,
  created_at BIGINT,
  updated_at BIGINT
);

CREATE TABLE IF NOT EXISTS incident_log (
  id TEXT PRIMARY KEY,
  detected_at BIGINT NOT NULL,
  severity TEXT NOT NULL,          -- 'low' | 'moderate' | 'high'
  category TEXT,                   -- 'data_leak' | 'unauthorized_access' | 'breach'
  description TEXT,
  data_subjects_affected INTEGER,
  cai_notified INTEGER DEFAULT 0,
  subjects_notified INTEGER DEFAULT 0,
  resolved_at BIGINT
);

CREATE TABLE IF NOT EXISTS access_log (
  id TEXT PRIMARY KEY,
  data_subject_id TEXT,
  accessed_by TEXT,                -- agent_name ou 'system'
  action TEXT,                     -- 'read' | 'write' | 'delete' | 'transfer'
  resource_type TEXT,              -- 'agent_run' | 'knowledge_chunk'
  resource_id TEXT,
  purpose TEXT,
  timestamp BIGINT
);

CREATE TABLE IF NOT EXISTS retention_policies (
  id TEXT PRIMARY KEY,
  category TEXT NOT NULL,          -- 'agent_runs' | 'knowledge_chunks' | 'discord_messages'
  retention_days INTEGER NOT NULL,
  legal_basis TEXT,
  anonymize_after_days INTEGER,    -- anonymiser avant suppression (art. 23.1)
  active INTEGER DEFAULT 1
);

CREATE TABLE IF NOT EXISTS transfer_log (
  id TEXT PRIMARY KEY,
  data_subject_id TEXT,
  destination TEXT NOT NULL,       -- 'anthropic' | 'google' | 'openai' | etc.
  destination_region TEXT,         -- 'US' | 'EU' | 'QC'
  legal_mechanism TEXT,            -- 'standard_contractual_clauses' | 'adequacy' | 'explicit_consent'
  data_type TEXT,
  timestamp BIGINT
);
```

#### 1.2 Nouveaux outils MCP (7 outils Loi 25)

Créer dans `src/tools/` :

| Outil | Article | Rôle |
|---|---|---|
| `loi25_access_request` | 26 | Extrait tous les RP liés à un `data_subject_id` (export JSON) |
| `loi25_rectification` | 27 | Modifie un RP sur demande du sujet |
| `loi25_erasure` | 27 / 35.3 | Efface/anonymise les RP d'un sujet (droit à l'oubli) |
| `loi25_consent` | 8.1-8.2 | Enregistre/vérifie/révoque un consentement |
| `loi25_processing_registry` | 3-3.1 / 35.18 | Consulte le registre des traitements |
| `loi25_report_incident` | 3.5-3.8 | Signale un incident + génère notification CAI |
| `loi25_efvp` | 18.1 | Lance/consulte une évaluation des facteurs vie privée |

Chaque outil suit le pattern existant : `loi25_<nom>.ts` exporte `loi25<Nom>Schema`
+ `loi25<Nom>Function`, enregistré dans `server.ts`.

#### 1.3 Migration de données existantes

Script `scripts/loi25_backfill.mjs` :
- Scanne les `agent_runs` / `knowledge_chunks` existants
- Pour chaque enregistrement sans `data_subject_id` : tente de détecter un identifiant
  dans le prompt (regex email/Discord ID) ou marque `data_subject_id = 'legacy_unknown'`
- Applique une politique de rétention rétroactive (ex: 90 jours)
- Anonymise les enregistrements expirés

---

### Phase 2 — Privacy Guard (P0, exécution)

**Objectif** : intercepter chaque flux de RP pour appliquer les contrôles Loi 25.

#### 2.1 Middleware Loi25Guard

Créer `src/lib/loi25/guard.ts` — wrapper appliqué à chaque outil manipulant des RP :

```typescript
export interface Loi25Context {
  dataSubjectId?: string;      // obligatoire si RP détectés
  legalBasis: LegalBasis;      // 'consent' | 'contract' | 'legitimate_interest'
  consentRef?: string;         // requis si legalBasis = 'consent'
  purpose: string;             // finalité (art. 4)
  anonymize?: boolean;         // anonymiser avant stockage
}
```

**Mode mixte validé** — détection automatique de la base légale :
- **Tiers externes** (clients, citoyens via Discord/API) → `consent` obligatoire
  - Détection : `dataSubjectId` absent du registre interne → flag `external = true`
  - Le guard rejecte si pas de consentement valide
- **Usage interne** (toi + équipe) → `legitimate_interest` suffisant
  - Détection : `dataSubjectId` dans allowlist `OVERMIND_LOI25_INTERNAL_SUBJECTS`
  - Pas de blocage, mais log quand même dans `access_log`
- **Fallback** : si `OVERMIND_LOI25_ENABLED=false` → guard inactif, comportement v3.8

Le guard :
1. **Si `OVERMIND_LOI25_ENABLED=false`** → pass-through (zero overhead)
2. **Détection de la base légale** selon l'origine du sujet (interne vs tiers)
3. **Valide le consentement** si tiers → reject si expiré/révoqué
4. **Détecte les RP** dans le prompt (regex PII : email, téléphone, NAS, carte crédit)
5. **Hash/anonymise** si `anonymize = true` (SHA-256 de l'identifiant avant stockage)
6. **Log le transfert** si un runner LLM externe est appelé (art. 21) — documentation seule, pas de blocage
7. **Calcule la rétention** selon `retention_policies` et pose `retention_expires_at`

#### 2.2 Capture au niveau du Bridge

Modifier `src/bridge/OverBridgeService.ts` :
- Chaque message Discord entrant génère un `data_subject_id` (hash du Discord user ID)
- Le consentement est capturé : 1er message = capture implicite `legitimate_interest`,
  ou explicit si commande `!consent` / `!revoke`
- Le `Loi25Context` est propagé jusqu'à `storeRun()`

#### 2.3 Hooks runners

Modifier chaque `*Runner.ts` (8 fichiers) :
- Avant l'appel LLM : log dans `transfer_log` (provider, région, mécanisme légal)
- **Pas de blocage** (décision validée) — tous les providers restent accessibles
- Config flag optionnel `OVERMIND_PII_FILTER=true` : filtre les RP du prompt avant envoi
- La cartographie des transferts est consultable via l'outil `loi25_processing_registry`

---

### Phase 3 — Lifecycle & Anonymisation (P1)

#### 3.1 Cron de rétention + archivage 5 ans

Créer `scripts/loi25_retention_cron.mjs` (exécutable via systemd / Hermes cron) :
- **Rétention active** : 30 jours pour `agent_runs` ET `knowledge_chunks` (défaut validé)
- **Avant suppression** : archive vers table `archived_runs` / `archived_chunks` (cold storage)
- **Archivage 5 ans** : les archives sont conservées 5 ans puis purgées définitivement
- Suit `retention_policies` table : configurable par catégorie
- Anonymise d'abord (art. 23.1), archive, puis supprime de la table active

**Double table** (hot → cold → delete) :

```sql
-- Archive cold storage (5 ans)
CREATE TABLE IF NOT EXISTS archived_runs (LIKE agent_runs INCLUDING ALL);
ALTER TABLE archived_runs ADD COLUMN archived_at BIGINT;
ALTER TABLE archived_runs ADD COLUMN archive_expires_at BIGINT;  -- +5 ans

CREATE TABLE IF NOT EXISTS archived_chunks (LIKE knowledge_chunks INCLUDING ALL);
ALTER TABLE archived_chunks ADD COLUMN archived_at BIGINT;
ALTER TABLE archived_chunks ADD COLUMN archive_expires_at BIGINT;
```

**Workflow cron (chaque 24h)** :
1. `SELECT * FROM agent_runs WHERE retention_expires_at < now()` → anonymise → insert dans `archived_runs` (avec `archive_expires_at = now + 5 ans`) → delete de `agent_runs`
2. Idem pour `knowledge_chunks` → `archived_chunks`
3. `DELETE FROM archived_* WHERE archive_expires_at < now()` (purge définitive >5 ans)

#### 3.1.1 Feature flag `.env`

```bash
# .env — Loi 25 feature flag
OVERMIND_LOI25_ENABLED=true              # master switch (false = pas de guard, comportement v3.8)
OVERMIND_LOI25_RETENTION_DAYS=30         # rétention active (défaut 30j)
OVERMIND_LOI25_ARCHIVE_YEARS=5           # archivage cold storage (défaut 5 ans)
OVERMIND_LOI25_DEFAULT_BASIS=legitimate_interest  # base légale par défaut
OVERMIND_LOI25_AUTO_ANONYMIZE=true       # anonymisation à l'expiration
```

#### 3.2 Anonymisation technique

Créer `src/lib/loi25/anonymize.ts` :
- Pseudonymisation : remplace identifiants directs par hash SHA-256 + salt
- K-anonymité sur embeddings : bruit gaussien pour réduire la ré-identification
- Généralisation : tronque timestamps à la journée, géoloc à la région

#### 3.3 Détection d'incident

Étendre le système d'alerte existant (`triggerMemoryAlert`) :
- Alertes → `incident_log` au lieu de log seul
- Détection d'anomalies : accès inhabituel, volume anormal, erreur DB répétée
- Workflow de notification (art. 3.5) : template CAI + template sujet

---

### Phase 4 — Transparence & Documentation (P1)

#### 4.1 Politique de confidentialité machine-readable

Créer `docs/PRIVACY_POLICY.json` (structuré, consommable par `loi25_processing_registry`) :
- Finalités par traitement
- Bases légales
- Destinataires (providers LLM + leurs régions)
- Durées de conservation
- Droits des personnes + modalités d'exercice

#### 4.2 Cartographie des transferts

Créer `src/lib/loi25/transfer_map.ts` — référentiel des 8 providers :

```typescript
export const PROVIDER_REGISTRY = {
  anthropic:  { region: 'US', mechanism: 'standard_contractual_clauses', documented: true },
  google:     { region: 'US', mechanism: 'standard_contractual_clauses', documented: true },
  openai:     { region: 'US', mechanism: 'standard_contractual_clauses', documented: true },
  minimax:    { region: 'CN', mechanism: 'explicit_consent', documented: false },
  zai:        { region: 'CN', mechanism: 'explicit_consent', documented: false },
  kimi:       { region: 'CN', mechanism: 'explicit_consent', documented: false },
  // ...
};
```

#### 4.3 Documentation EFVP

Créer `docs/EFVP_OVERMIND.md` (évaluation des facteurs relatifs à la vie privée) :
- Template structuré selon grille CAI
- Analyse des 8 axes Loi 25
- Mesures d'atténuation

#### 4.4 Dashboard conformité

Étendre `get_metrics` tool (existant) :
- Ajoute une section `loi25` : consentements actifs, incidents ouverts, rétention à venir,
  transferts des dernières 24h

---

## 5. Nouveaux fichiers à créer

```
src/
├── lib/
│   └── loi25/
│       ├── guard.ts              # Middleware Privacy Guard
│       ├── anonymize.ts          # Fonctions d'anonymisation
│       ├── transfer_map.ts       # Registre des providers/transferts
│       ├── retention.ts          # Moteur de rétention
│       └── types.ts              # Types Loi25Context, etc.
├── tools/
│   ├── loi25_access_request.ts
│   ├── loi25_rectification.ts
│   ├── loi25_erasure.ts
│   ├── loi25_consent.ts
│   ├── loi25_processing_registry.ts
│   ├── loi25_report_incident.ts
│   └── loi25_efvp.ts
scripts/
├── loi25_migration.mjs           # Schema migration
├── loi25_backfill.mjs            # Migration des données legacy
└── loi25_retention_cron.mjs      # Cron de purge/anonymisation
docs/
├── PRIVACY_POLICY.json           # Politique machine-readable
├── EFVP_OVERMIND.md              # Évaluation facteurs vie privée
└── PLAN_LOI25_INTEGRATION.md     # Ce document
```

## 6. Fichiers à modifier

| Fichier | Modification |
|---|---|
| `src/memory/PostgresMemoryProvider.ts` | + colonnes governance, + 7 nouvelles tables |
| `src/memory/types.ts` | + types Loi25 (ConsentRecord, IncidentLog, etc.) |
| `src/server.ts` | + enregistrement 7 nouveaux outils Loi 25 |
| `src/bridge/OverBridgeService.ts` | + capture consentement + data_subject_id |
| `src/services/*Runner.ts` (8 fichiers) | + hook transfer_log |
| `src/tools/get_metrics.ts` | + section conformité Loi 25 |
| `package.json` | bump 3.9.0 + bin `overmind-loi25-migrate` |
| `.env.example` | + flags `OVERMIND_DATA_RESIDENCY`, `OVERMIND_PII_FILTER` |

## 7. Estimation effort

| Phase | Fichiers | LOC estimé | Tests |
|---|---|---|---|
| 1 — Fondations | 12 | ~1500 | 10 tests |
| 2 — Privacy Guard | 12 | ~1200 | 8 tests |
| 3 — Lifecycle | 4 | ~600 | 5 tests |
| 4 — Transparence | 5 | ~400 | 3 tests |
| **Total** | **33** | **~3700** | **26 tests** |

## 8. Risques

1. **Rétrocompatibilité** : les colonnes ajoutées sont nullable → pas de cassure
2. **Performance** : le guard ajoute ~5ms par requête (regex PII + log) — négligeable
3. **Providers CN** (zai/kimi/minimax-cn) : transferts Chine = mécanisme `explicit_consent`
   obligatoire → bloquant si pas de consentement explicite
4. **Embeddings legacy** : les `knowledge_chunks` existants n'ont pas de `data_subject_id`
   → backfill best-effort + anonymisation conservative

## 9. Tests de conformité (critères d'acceptation)

- ✅ `loi25_access_request(data_subject_id)` retourne tous les RP en <2s
- ✅ `loi25_erasure(data_subject_id)` supprime/hash tous les RP + embeddings
- ✅ Chaque `agent_run` stocké a un `legal_basis` + `retention_expires_at`
- ✅ Chaque appel runner LLM génère une entrée `transfer_log`
- ✅ Cron de rétention purge les enregistrements expirés sans erreur
- ✅ `get_metrics` affiche le taux de conformité (consentements actifs / incidents)
- ✅ Anonymisation : un RP effacé ne peut pas être ré-identifié via embeddings

## 10. Décisions de périmètre (validées 21 juillet 2026)

| Question | Décision | Impact |
|---|---|---|
| **Périmètre RP** | Mixte — consentement explicite (tiers) + intérêt légitime (interne) | Guard détecte l'origine automatiquement, allowlist `.env` |
| **Transferts hors QC** | Documentation seule, aucun blocage | `transfer_log` + cartographie, mais tous les providers restent accessibles |
| **Rétention** | 30 jours active + 5 ans archivage cold storage | Double table `archived_*`, cron anonymise → archive → purge |
| **Activation** | Feature flag `OVERMIND_LOI25_ENABLED=true` | Désactivé = comportement v3.8 inchangé (rétrocompatible) |

---

## 11. Ordre d'exécution recommandé

```
Étape 1 → scripts/loi25_migration.mjs (schema)
Étape 2 → src/lib/loi25/types.ts + guard.ts + transfer_map.ts
Étape 3 → src/tools/loi25_*.ts (7 outils)
Étape 4 → src/server.ts (enregistrement outils)
Étape 5 → Hooks runners (8 fichiers)
Étape 6 → Bridge capture consentement
Étape 7 → scripts/loi25_retention_cron.mjs
Étape 8 → scripts/loi25_backfill.mjs (migration legacy)
Étape 9 → Tests + docs
Étape 10 → Bump version 3.9.0 + changeset
```

**Prêt à coder quand tu dis go.**
