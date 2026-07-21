---
"overmind-mcp": minor
---

feat(loi25): intégration complète Loi 25 QC — conformité protection des RP

**7 nouveaux outils MCP (art. 3-35 Loi 25 QC):**
- `loi25_access_request` (art. 26) — droit d'accès aux RP
- `loi25_erasure` (art. 27/35.3) — droit d'effacement / anonymisation
- `loi25_consent` (art. 8.1-8.2) — gestion du consentement (grant/revoke/check)
- `loi25_rectification` (art. 27) — droit de rectification
- `loi25_processing_registry` (art. 3/35.18) — registre des traitements + cartographie transferts
- `loi25_report_incident` (art. 3.5-3.8) — notification d'incident de confidentialité
- `loi25_efvp` (art. 18.1) — évaluation des facteurs relatifs à la vie privée

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
- Cron `loi25_retention_cron.mjs` : hot (30j) → anonymisation → archive (5 ans) → purge
- Feature flag `OVERMIND_LOI25_ENABLED=true` (désactivé = comportement v3.8)

**Scripts:**
- `overmind-loi25-migrate` — migration du schéma PostgreSQL
- `loi25_backfill.mjs` — migration des données legacy
- `loi25_retention_cron.mjs` — cron de rétention + archivage

**Décisions validées:**
- Périmètre mixte : consentement (tiers) + intérêt légitime (interne)
- Transferts : documentation seule, aucun blocage de providers
- Rétention : 30 jours active + 5 ans archive cold storage
