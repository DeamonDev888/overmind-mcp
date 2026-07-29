---
"overmind-mcp": minor
---

feat(loi25): intégration complète Loi 25 QC — conformité protection des RP

**7 nouveaux outils MCP (art. 3-35 Loi 25 QC):**
- `audit_access_request` (art. 26) — droit d'accès aux RP
- `audit_erasure` (art. 27/35.3) — droit d'effacement / anonymisation
- `audit_consent` (art. 8.1-8.2) — gestion du consentement (grant/revoke/check)
- `audit_rectification` (art. 27) — droit de rectification
- `audit_processing_registry` (art. 3/35.18) — registre des traitements + cartographie transferts
- `audit_report_incident` (art. 3.5-3.8) — notification d'incident de confidentialité
- `audit_efvp` (art. 18.1) — évaluation des facteurs relatifs à la vie privée

**Architecture privacy-by-design:**
- Middleware `Loi25Guard` intercepte chaque flux de RP (détection PII, validation consentement, pseudonymisation)
- Hooks runners centralisés dans `run_agent.ts` (1 point d'entrée pour les 8 runners)
- Capture bridge : pseudonymise les externalKeys (Discord/Twilio/Telegram) en `data_subject_id`
- Cartographie des 8 providers LLM (région + mécanisme légal de transfert)

**Gouvernance des données (7 nouvelles tables + 2 archives):**
- `data_subjects`, `consent_records`, `processing_registry`, `incident_log`
- `access_log`, `transfer_log`, `retention_policies`
- `archived_runs`, `archived_chunks` (cold storage)
- Colonnes Loi 25 ajoutées à `agent_runs` + `knowledge_chunks` (nullable, backward compatible)

**Rétention automatique:**
- Cron `audit_retention_cron.mjs` : hot (30j) → anonymisation → archive (5 ans) → purge
- Feature flag `OVERMIND_AUDIT_ENABLED=true` (désactivé = comportement v3.8)

**Scripts:**
- `overmind-loi25-migrate` — migration du schéma PostgreSQL
- `audit_backfill.mjs` — migration des données legacy
- `audit_retention_cron.mjs` — cron de rétention + archivage

**Décisions validées:**
- Périmètre mixte : consentement (tiers) + intérêt légitime (interne)
- Transferts : documentation seule, aucun blocage de providers
- Rétention : 30 jours active + 5 ans archive cold storage
