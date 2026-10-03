/**
 * Tests unitaires — Anti-régression server.ts (audit_* tools + pas de loi25_*)
 *
 * Les scripts CLI `audit_*.mjs` qui étaient autrefois testés ici ont été
 * retirés du package : la migration SQL idempotente est désormais livrée
 * dans le conteneur PostgreSQL dédié, et la logique hash/retention vit
 * dans `src/lib/audit/*`. La présence des 7 outils `audit_*` dans
 * `server.ts` reste verrouillée par ces tests.
 */

import { describe, it, expect } from 'vitest';
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
// Note on runtime import tests
// ═══════════════════════════════════════════════════════════════════════════════
//
// Les 3 scripts `audit_*.mjs` qui étaient testés ici (audit_migration,
// audit_backfill, audit_retention_cron) ont été retirés du package.
// La migration SQL idempotente vit désormais dans le conteneur PostgreSQL
// dédié (`docker/postgres/`), et la logique hash/retention vit dans
// `src/lib/audit/*`. Les tests structurels sur la présence des outils
// `audit_*` dans `server.ts` restent dans le bloc ci-dessus.

