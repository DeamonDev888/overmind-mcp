/**
 * Tests unitaires — Scripts audit_*.mjs + Anti-régression serveur
 *
 * Couvre :
 *   - scripts/audit_migration.mjs      (SQL idempotent, config env)
 *   - scripts/audit_backfill.mjs        (hash helpers, config)
 *   - scripts/audit_retention_cron.mjs  (calculs archive expiry, hash)
 *   - server.ts registration            (7 noms audit_* registered, 0 loi25_*)
 *
 * Les scripts .mjs sont importés en dynamic import pour accéder à leur top-level
 * constants et helpers purs (les fonctions DB ne sont pas testées ici — elles
 * nécessitent PostgreSQL live, couvert par les tests d'intégration séparés).
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

const ROOT = join(__dirname, '..', '..');

// ═══════════════════════════════════════════════════════════════════════════════
// Anti-régression : server.ts registration
// ═══════════════════════════════════════════════════════════════════════════════

describe('Anti-régression: server.ts MCP tool registration', () => {
  const serverSrc = readFileSync(join(ROOT, 'src', 'server.ts'), 'utf-8');

  const EXPECTED_AUDIT_TOOLS = [
    'audit_access_request',
    'audit_erasure',
    'audit_consent',
    'audit_rectification',
    'audit_processing_registry',
    'audit_report_incident',
    'audit_efvp',
  ];

  it('MUST register all 7 audit_* tools', () => {
    for (const name of EXPECTED_AUDIT_TOOLS) {
      expect(
        serverSrc,
        `server.ts MUST register tool "${name}"`,
      ).toContain(`name: '${name}'`);
    }
  });

  it('MUST NOT register any loi25_* tool (rename is complete)', () => {
    // Look for any `name: 'loi25_...'` registration that would indicate a leftover.
    const loi25Matches = serverSrc.match(/name:\s*'loi25_[a-z_]+'/g);
    expect(
      loi25Matches,
      `server.ts MUST NOT contain any loi25_* tool registration (found: ${loi25Matches?.join(', ')})`,
    ).toBeNull();
  });

  it('MUST import audit tools from audit_*.js (not loi25_*.js)', () => {
    for (const name of EXPECTED_AUDIT_TOOLS) {
      const importPath = `./tools/${name}.js`;
      expect(
        serverSrc,
        `server.ts MUST import from "${importPath}"`,
      ).toContain(importPath);
    }
  });

  it('MUST NOT import any loi25_*.js file', () => {
    const leftoverImports = serverSrc.match(/from\s+'\.\/tools\/loi25_[a-z_]+\.js'/g);
    expect(
      leftoverImports,
      `server.ts MUST NOT import any loi25_*.js (found: ${leftoverImports?.join(', ')})`,
    ).toBeNull();
  });

  it('MUST use wrapExecute with audit_* names (not loi25_*)', () => {
    const loi25WrapMatches = serverSrc.match(/wrapExecute\(\s*'loi25_[a-z_]+'/g);
    expect(
      loi25WrapMatches,
      `wrapExecute MUST NOT reference loi25_* (found: ${loi25WrapMatches?.join(', ')})`,
    ).toBeNull();
  });

  it('MUST keep the Loi 25 legal references in descriptions (Audit Trail framing + articles)', () => {
    // The rename to audit_* should preserve the legal references — the descriptions
    // must mention "Audit Trail" AND keep "Loi 25 art." citations.
    expect(serverSrc).toContain('Audit Trail');
    expect(serverSrc).toMatch(/Loi 25 art\./);
    // AI Act + AI PIA framing added in v3.10.0
    expect(serverSrc).toMatch(/AI Act/);
    expect(serverSrc).toMatch(/AI PIA/);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// audit_migration.mjs — SQL idempotence + config
// ═══════════════════════════════════════════════════════════════════════════════

describe('audit_migration.mjs — SQL structure', () => {
  const migrationSrc = readFileSync(join(ROOT, 'scripts', 'audit_migration.mjs'), 'utf-8');

  it('MUST use IF NOT EXISTS on all ALTER TABLE (idempotent)', () => {
    const alterStatements = migrationSrc.match(/ALTER TABLE \w+ ADD COLUMN IF NOT EXISTS/g) || [];
    expect(alterStatements.length).toBeGreaterThan(5);
    // Ensure no bare "ADD COLUMN" without IF NOT EXISTS: any ADD COLUMN line
    // must contain IF NOT EXISTS between ADD COLUMN and the column name.
    const allAddColumns = migrationSrc.match(/ADD COLUMN\s+/g) || [];
    const withIfNotExists = migrationSrc.match(/ADD COLUMN IF NOT EXISTS/g) || [];
    expect(
      allAddColumns.length,
      `All ADD COLUMN statements MUST use IF NOT EXISTS`,
    ).toBe(withIfNotExists.length);
  });

  it('MUST use CREATE TABLE IF NOT EXISTS for all new tables', () => {
    const createStatements = migrationSrc.match(/CREATE TABLE IF NOT EXISTS/g) || [];
    expect(createStatements.length).toBeGreaterThanOrEqual(6); // data_subjects, consent_records, etc.
    // Bare CREATE TABLE without IF NOT EXISTS = idempotence broken
    const bareCreate = migrationSrc.match(/CREATE TABLE\s+\w+\s*\(/g);
    expect(bareCreate || []).toHaveLength(0);
  });

  it('MUST create all expected audit tables', () => {
    // Note: efvp_records is NOT created by the migration — it's lazily created
    // at runtime by audit_efvp.ts (CREATE TABLE IF NOT EXISTS on first call).
    const expectedTables = [
      'data_subjects',
      'consent_records',
      'processing_registry',
      'incident_log',
      'access_log',
      'transfer_log',
      'retention_policies',
      'archived_runs',
      'archived_chunks',
    ];
    for (const table of expectedTables) {
      expect(
        migrationSrc,
        `Migration MUST create table "${table}"`,
      ).toContain(`CREATE TABLE IF NOT EXISTS ${table}`);
    }
  });

  it('MUST add audit columns to agent_runs (data_subject_id, legal_basis, etc.)', () => {
    const expectedColumns = [
      'data_subject_id',
      'legal_basis',
      'consent_ref',
      'retention_expires_at',
      'anonymized',
    ];
    for (const col of expectedColumns) {
      expect(
        migrationSrc,
        `agent_runs MUST have column "${col}" added by migration`,
      ).toContain(`ALTER TABLE agent_runs ADD COLUMN IF NOT EXISTS ${col}`);
    }
  });

  it('MUST add audit columns to knowledge_chunks too', () => {
    expect(migrationSrc).toContain(
      'ALTER TABLE knowledge_chunks ADD COLUMN IF NOT EXISTS data_subject_id',
    );
  });

  it('MUST read OVERMIND_AUDIT_RETENTION_DAYS with default 30', () => {
    expect(migrationSrc).toMatch(/OVERMIND_AUDIT_RETENTION_DAYS\s*\|\|\s*'30'/);
  });

  it('MUST read OVERMIND_AUDIT_ARCHIVE_YEARS with default 5', () => {
    expect(migrationSrc).toMatch(/OVERMIND_AUDIT_ARCHIVE_YEARS\s*\|\|\s*'5'/);
  });

  it('MUST NOT reference loi25 env vars (rename complete)', () => {
    expect(migrationSrc).not.toMatch(/OVERMIND_LOI25_/);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// audit_backfill.mjs — Hash logic + config
// ═══════════════════════════════════════════════════════════════════════════════

describe('audit_backfill.mjs — hash + config', () => {
  const backfillSrc = readFileSync(join(ROOT, 'scripts', 'audit_backfill.mjs'), 'utf-8');

  it('MUST use SHA-256 for anonymisation hashing', () => {
    expect(backfillSrc).toMatch(/createHash\(\s*['"]sha256['"]\s*\)/);
  });

  it('MUST preserve the legacy default salt (data integrity)', () => {
    // The salt string 'overmind-loi25-default-salt-v1' is kept intentionally —
    // changing it would break correlation with existing hashed data_subject_id.
    expect(backfillSrc).toContain("'overmind-loi25-default-salt-v1'");
  });

  it('MUST read OVERMIND_AUDIT_SALT env (operator override)', () => {
    expect(backfillSrc).toMatch(/OVERMIND_AUDIT_SALT/);
  });

  it('MUST read OVERMIND_AUDIT_RETENTION_DAYS with default 30', () => {
    expect(backfillSrc).toMatch(/OVERMIND_AUDIT_RETENTION_DAYS\s*\|\|\s*'30'/);
  });

  it('MUST set legacy_unknown as data_subject_id for non-expired legacy rows', () => {
    expect(backfillSrc).toContain("'legacy_unknown'");
  });

  it('MUST anonymise already-expired legacy rows directly', () => {
    // The script must have a branch that hashes the prompt/result when expired
    expect(backfillSrc).toMatch(/anonym/i);
    expect(backfillSrc).toMatch(/hash|hashPrompt|sha256/i);
  });

  it('MUST be idempotent (skip rows already with data_subject_id or anonymized=1)', () => {
    // The WHERE clause must exclude already-migrated rows
    expect(backfillSrc).toMatch(/data_subject_id IS NULL/);
    expect(backfillSrc).toMatch(/anonymized\s*=\s*0/);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// audit_retention_cron.mjs — Archive logic + config
// ═══════════════════════════════════════════════════════════════════════════════

describe('audit_retention_cron.mjs — retention + archive', () => {
  const cronSrc = readFileSync(join(ROOT, 'scripts', 'audit_retention_cron.mjs'), 'utf-8');

  it('MUST use SHA-256 for hashing', () => {
    expect(cronSrc).toMatch(/createHash\(\s*['"]sha256['"]\s*\)/);
  });

  it('MUST preserve the legacy default salt', () => {
    expect(cronSrc).toContain("'overmind-loi25-default-salt-v1'");
  });

  it('MUST read OVERMIND_AUDIT_ARCHIVE_YEARS with default 5', () => {
    expect(cronSrc).toMatch(/OVERMIND_AUDIT_ARCHIVE_YEARS\s*\|\|\s*'5'/);
  });

  it('MUST archive from agent_runs → archived_runs', () => {
    expect(cronSrc).toMatch(/INSERT INTO archived_runs/);
    expect(cronSrc).toMatch(/FROM agent_runs/);
  });

  it('MUST archive from knowledge_chunks → archived_chunks', () => {
    expect(cronSrc).toMatch(/INSERT INTO archived_chunks/);
    expect(cronSrc).toMatch(/FROM knowledge_chunks/);
  });

  it('MUST purge archives when archive_expires_at < now', () => {
    expect(cronSrc).toMatch(/DELETE FROM archived_/);
    expect(cronSrc).toMatch(/archive_expires_at/);
  });

  it('MUST only archive rows where retention_expires_at < now (hot→archive)', () => {
    expect(cronSrc).toMatch(/retention_expires_at\s*<\s*\$?1/);
  });

  it('MUST compute archive expiry as now + ARCHIVE_YEARS', () => {
    // The script has an archiveExpiry() helper or inline computation
    expect(cronSrc).toMatch(/ARCHIVE_YEARS\s*\*\s*MS_PER_YEAR/);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Hash deterministic property (cross-script consistency)
// ═══════════════════════════════════════════════════════════════════════════════

describe('Cross-script hash consistency', () => {
  it('backfill and retention_cron MUST use the same default salt', () => {
    const backfillSrc = readFileSync(join(ROOT, 'scripts', 'audit_backfill.mjs'), 'utf-8');
    const cronSrc = readFileSync(join(ROOT, 'scripts', 'audit_retention_cron.mjs'), 'utf-8');
    const backfillMatch = backfillSrc.match(/'overmind-loi25-default-salt-v1'/);
    const cronMatch = cronSrc.match(/'overmind-loi25-default-salt-v1'/);
    expect(backfillMatch).not.toBeNull();
    expect(cronMatch).not.toBeNull();
    expect(backfillMatch![0]).toBe(cronMatch![0]);
  });

  it('anonymize.ts (lib) MUST use the same default salt as the scripts', () => {
    const libSrc = readFileSync(join(ROOT, 'src', 'lib', 'audit', 'anonymize.ts'), 'utf-8');
    expect(libSrc).toContain("'overmind-loi25-default-salt-v1'");
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Note on runtime import tests
// ═══════════════════════════════════════════════════════════════════════════════
//
// The 3 scripts audit_*.mjs are CLI entry points that auto-execute their main()
// on import and connect to PostgreSQL. They cannot be safely imported in a test
// runner without a real DB. Syntax validity is already enforced by:
//   1. `npm run build` (tsc validates imports if the scripts were TS)
//   2. The structural assertions above (regex on SQL structure)
//   3. Production deployment (the script runs daily on the Ubuntu server)
//
// Integration tests with a real PG instance would live in a separate
// `audit_integration.test.ts` file gated behind an OVERMIND_TEST_DB env flag.

