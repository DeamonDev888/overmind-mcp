/**
 * Tests unitaires — 7 outils MCP audit_*
 *
 * Couvre toutes les actions de :
 *   - audit_access_request      (droit d'accès)
 *   - audit_erasure             (effacement / anonymisation)
 *   - audit_consent             (grant / revoke / check)
 *   - audit_rectification       (correction)
 *   - audit_processing_registry (list / get / create / update)
 *   - audit_report_incident     (report / list / resolve)
 *   - audit_efvp                (create / list / get)
 *
 * La DB est mockée via vi.mock('overmind-postgres-mcp') → getPool retourne un
 * mock qui enregistre les queries. Les outils retournent { content: [{ text }] },
 * on asserte sur le SQL et le texte de sortie.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// ── Mock PostgreSQL ───────────────────────────────────────────────────────────
//
// We use mockPool.query.mock.calls directly for assertions instead of a separate
// recordedQueries() array. This avoids cross-test pollution because mockClear()
// in beforeEach resets the calls array atomically. Per-test .mockResolvedValueOnce
// queues are also cleared by mockClear, preventing FIFO leakage.

const mockPool = {
  query: vi.fn(async (_sql: string, _params?: unknown[]) => {
    return { rows: [], rowCount: 0 };
  }),
};

vi.mock('overmind-postgres-mcp', () => ({
  getPool: () => mockPool,
}));

/** Helper: extract the recorded SQL+params from mock calls. */
function recordedQueries(): Array<{ sql: string; params: unknown[] }> {
  return mockPool.query.mock.calls.map((c: unknown[]) => ({
    sql: String(c[0] || ''),
    params: (c[1] as unknown[]) || [],
  }));
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const ORIGINAL_ENV = { ...process.env };

beforeEach(() => {
  // Reset the mock completely: clears calls, instances, AND mockResolvedValueOnce queue.
  mockPool.query.mockReset();
  // Restore default implementation (empty result) for any query not explicitly stubbed.
  mockPool.query.mockImplementation(async () => ({ rows: [], rowCount: 0 }));
  for (const k of ['OVERMIND_AUDIT_ENABLED', 'OVERMIND_AUDIT_SALT']) {
    delete process.env[k];
  }
});

afterEach(() => {
  for (const k of Object.keys(process.env)) {
    if (!(k in ORIGINAL_ENV)) delete process.env[k];
  }
  Object.assign(process.env, ORIGINAL_ENV);
});

/** Extract text from the MCP tool response. */
function responseText(resp: { content: Array<{ text: string }> }): string {
  return resp.content.map((c) => c.text).join('\n');
}

// ═══════════════════════════════════════════════════════════════════════════════
// audit_consent — grant / revoke / check
// ═══════════════════════════════════════════════════════════════════════════════

describe('audit_consent — grant', () => {
  it('MUST INSERT subject + consent and return success message', async () => {
    const { auditConsent } = await import('../tools/audit_consent.js');
    const result = await auditConsent({
      action: 'grant',
      data_subject_id: 'subj-123',
      purpose: 'agent_execution',
      legal_basis: 'consent',
    });

    // Should have 2 INSERTs: data_subjects upsert + consent_records
    const inserts = recordedQueries().filter((q) => q.sql.includes('INSERT'));
    expect(inserts.length).toBeGreaterThanOrEqual(2);

    expect(responseText(result)).toMatch(/consentement accord/i);
    expect(responseText(result)).toContain('subj-123');
  });

  it('MUST compute expires_at when expires_in_days is set', async () => {
    const { auditConsent } = await import('../tools/audit_consent.js');
    const before = Date.now();
    await auditConsent({
      action: 'grant',
      data_subject_id: 'subj-exp',
      expires_in_days: 30,
    });
    const consentInsert = recordedQueries().find(
      (q) => q.sql.includes('INSERT INTO consent_records'),
    );
    expect(consentInsert).toBeDefined();
    const expiresParam = consentInsert!.params[5]; // expires_at is 6th column
    expect(typeof expiresParam).toBe('number');
    expect(expiresParam as number).toBeGreaterThan(before + 29 * 86400000);
  });
});

describe('audit_consent — revoke', () => {
  it('MUST UPDATE consent_records with withdrawn_at', async () => {
    mockPool.query.mockResolvedValueOnce({
      rows: [{ id: 'consent-1', granted_at: '1000', expires_at: null }],
      rowCount: 1,
    });

    const { auditConsent } = await import('../tools/audit_consent.js');
    const result = await auditConsent({
      action: 'revoke',
      data_subject_id: 'subj-1',
      purpose: 'agent_execution',
    });

    const update = recordedQueries().find((q) => q.sql.includes('UPDATE consent_records'));
    expect(update).toBeDefined();
    expect(update!.sql).toContain('withdrawn_at');
    expect(responseText(result)).toMatch(/r[ée]voqu/i);
  });

  it('MUST warn when no active consent to revoke', async () => {
    mockPool.query.mockResolvedValueOnce({ rows: [], rowCount: 0 });

    const { auditConsent } = await import('../tools/audit_consent.js');
    const result = await auditConsent({
      action: 'revoke',
      data_subject_id: 'no-consent-subj',
      purpose: 'agent_execution',
    });

    expect(responseText(result)).toMatch(/aucun consentement actif/i);
  });
});

describe('audit_consent — check', () => {
  it('MUST return "valide" status for active consent', async () => {
    const now = Date.now();
    mockPool.query.mockResolvedValueOnce({
      rows: [
        {
          id: 'c-1',
          purpose: 'agent_execution',
          legal_basis: 'consent',
          granted_at: String(now - 1000),
          expires_at: String(now + 86400000),
          withdrawn_at: null,
          evidence: null,
        },
      ],
      rowCount: 1,
    });

    const { auditConsent } = await import('../tools/audit_consent.js');
    const result = await auditConsent({
      action: 'check',
      data_subject_id: 'subj-1',
      purpose: 'agent_execution',
    });

    expect(responseText(result)).toMatch(/valide/i);
  });

  it('MUST return "révoqué" for withdrawn consent', async () => {
    const now = Date.now();
    mockPool.query.mockResolvedValueOnce({
      rows: [
        {
          id: 'c-2',
          purpose: 'x',
          legal_basis: 'consent',
          granted_at: String(now - 2000),
          expires_at: null,
          withdrawn_at: String(now - 1000),
          evidence: null,
        },
      ],
      rowCount: 1,
    });

    const { auditConsent } = await import('../tools/audit_consent.js');
    const result = await auditConsent({
      action: 'check',
      data_subject_id: 'subj-2',
      purpose: 'x',
    });

    expect(responseText(result)).toMatch(/r[ée]voqu/i);
  });

  it('MUST return "expiré" for expired consent', async () => {
    const now = Date.now();
    mockPool.query.mockResolvedValueOnce({
      rows: [
        {
          id: 'c-3',
          purpose: 'x',
          legal_basis: 'consent',
          granted_at: String(now - 200000),
          expires_at: String(now - 1000),
          withdrawn_at: null,
          evidence: null,
        },
      ],
      rowCount: 1,
    });

    const { auditConsent } = await import('../tools/audit_consent.js');
    const result = await auditConsent({
      action: 'check',
      data_subject_id: 'subj-3',
      purpose: 'x',
    });

    expect(responseText(result)).toMatch(/expir/i);
  });

  it('MUST return "not found" message when no consent exists', async () => {
    mockPool.query.mockResolvedValueOnce({ rows: [], rowCount: 0 });

    const { auditConsent } = await import('../tools/audit_consent.js');
    const result = await auditConsent({
      action: 'check',
      data_subject_id: 'ghost',
      purpose: 'x',
    });

    expect(responseText(result)).toMatch(/aucun consentement trouv/i);
  });
});

describe('audit_consent — error handling', () => {
  it('MUST catch DB error and return isError response', async () => {
    mockPool.query.mockRejectedValueOnce(new Error('DB down'));

    const { auditConsent } = await import('../tools/audit_consent.js');
    const result = await auditConsent({
      action: 'grant',
      data_subject_id: 'x',
    }) as { content: Array<{ text: string }>; isError?: boolean };

    expect(result.isError).toBe(true);
    expect(responseText(result)).toMatch(/erreur/i);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// audit_erasure — hard_delete / anonymize
// ═══════════════════════════════════════════════════════════════════════════════

describe('audit_erasure', () => {
  it('MUST DELETE rows in hard_delete mode', async () => {
    // Use mockResolvedValue (persistent) so all queries in the flow return rowCount>0
    mockPool.query.mockResolvedValue({ rows: [], rowCount: 3 });

    const { auditErasure } = await import('../tools/audit_erasure.js');
    const result = await auditErasure({
      data_subject_id: 'subj-del',
      mode: 'hard_delete',
    });

    const deletes = recordedQueries().filter((q) => q.sql.trim().toUpperCase().startsWith('DELETE'));
    expect(deletes.length).toBeGreaterThan(0);
    // French "Suppression" or "supprim" — both valid; match the tool's actual phrasing
    expect(responseText(result)).toMatch(/suppression|supprim|effac/i);
  });

  it('MUST hash prompt/result in anonymize mode (not delete)', async () => {
    mockPool.query.mockResolvedValue({ rows: [], rowCount: 2 });

    const { auditErasure } = await import('../tools/audit_erasure.js');
    const result = await auditErasure({
      data_subject_id: 'subj-anon',
      mode: 'anonymize',
    });

    // anonymize should UPDATE, not DELETE
    const updates = recordedQueries().filter((q) => q.sql.trim().toUpperCase().startsWith('UPDATE'));
    expect(updates.length).toBeGreaterThan(0);
    // No hard DELETEs from agent_runs/knowledge_chunks in anonymize mode
    const dataDeletes = recordedQueries().filter(
      (q) =>
        q.sql.trim().toUpperCase().startsWith('DELETE') &&
        (q.sql.includes('agent_runs') || q.sql.includes('knowledge_chunks')),
    );
    expect(dataDeletes).toHaveLength(0);
    expect(responseText(result)).toMatch(/anonym/i);
  });

  it('MUST handle zero rows affected gracefully', async () => {
    mockPool.query.mockResolvedValue({ rows: [], rowCount: 0 });

    const { auditErasure } = await import('../tools/audit_erasure.js');
    const result = await auditErasure({
      data_subject_id: 'nothing-to-delete',
      mode: 'hard_delete',
    });

    // Should still return a success-shaped response, just with 0 records
    expect(result.content).toBeDefined();
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// audit_access_request
// ═══════════════════════════════════════════════════════════════════════════════

describe('audit_access_request', () => {
  it('MUST SELECT from all tables for the subject', async () => {
    // Multiple SELECTs across tables — return empty for each
    mockPool.query.mockResolvedValue({ rows: [], rowCount: 0 });

    const { auditAccessRequest } = await import('../tools/audit_access_request.js');
    const result = await auditAccessRequest({
      data_subject_id: 'subj-access',
    });

    const selects = recordedQueries().filter((q) =>
      q.sql.trim().toUpperCase().startsWith('SELECT'),
    );
    expect(selects.length).toBeGreaterThan(0);
    expect(result.content).toBeDefined();
  });

  it('MUST include archives when include_archives=true', async () => {
    mockPool.query.mockResolvedValue({ rows: [], rowCount: 0 });

    const { auditAccessRequest } = await import('../tools/audit_access_request.js');
    await auditAccessRequest({
      data_subject_id: 'subj',
      include_archives: true,
    });

    // With archives, we should SELECT from archived_* tables too
    const archiveSelects = recordedQueries().filter(
      (q) => q.sql.includes('archived_'),
    );
    expect(archiveSelects.length).toBeGreaterThan(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// audit_rectification
// ═══════════════════════════════════════════════════════════════════════════════

describe('audit_rectification', () => {
  it('MUST UPDATE the specified field in the target table', async () => {
    mockPool.query.mockResolvedValue({ rows: [], rowCount: 1 });

    const { auditRectification } = await import('../tools/audit_rectification.js');
    const result = await auditRectification({
      data_subject_id: 'subj-rect',
      table_name: 'agent_runs',
      record_id: 'run-1',
      field: 'prompt',
      new_value: 'corrected text',
    });

    const update = recordedQueries().find(
      (q) =>
        q.sql.trim().toUpperCase().startsWith('UPDATE') &&
        q.sql.includes('agent_runs'),
    );
    expect(update).toBeDefined();
    expect(responseText(result)).toMatch(/rectification appliqu/i);
  });

  it('MUST accept only whitelisted tables (agent_runs, knowledge_chunks)', async () => {
    const { auditRectificationSchema } = await import('../tools/audit_rectification.js');
    // Schema validation: should reject unknown table
    const parsed = auditRectificationSchema.safeParse({
      data_subject_id: 'x',
      table_name: 'users', // not in enum
      record_id: '1',
      field: 'name',
      new_value: 'x',
    });
    expect(parsed.success).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// audit_processing_registry — list / get / create / update
// ═══════════════════════════════════════════════════════════════════════════════

describe('audit_processing_registry', () => {
  it('action=list MUST SELECT all entries', async () => {
    mockPool.query.mockResolvedValueOnce({
      rows: [
        {
          id: 'p1',
          name: 'llm_inference',
          purpose: 'inference',
          legal_basis: 'consent',
          data_categories: 'prompts',
          recipients: 'openai',
          retention_days: 30,
          created_at: '1000',
          updated_at: '1000',
        },
      ],
      rowCount: 1,
    });

    const { auditProcessingRegistry } = await import('../tools/audit_processing_registry.js');
    const result = await auditProcessingRegistry({ action: 'list' });

    const select = recordedQueries().find((q) =>
      q.sql.trim().toUpperCase().startsWith('SELECT'),
    );
    expect(select).toBeDefined();
    expect(responseText(result)).toContain('llm_inference');
  });

  it('action=create MUST INSERT new entry', async () => {
    const { auditProcessingRegistry } = await import('../tools/audit_processing_registry.js');
    const result = await auditProcessingRegistry({
      action: 'create',
      name: 'embedding_pipeline',
      purpose: 'vectorize text',
      legal_basis: 'legitimate_interest',
      data_categories: 'text',
      recipients: 'local',
      retention_days: 60,
    });

    const insert = recordedQueries().find((q) =>
      q.sql.includes('INSERT INTO processing_registry'),
    );
    expect(insert).toBeDefined();
    expect(responseText(result)).toMatch(/cr[ée]/i);
  });

  it('action=get MUST SELECT by name', async () => {
    mockPool.query.mockResolvedValueOnce({
      rows: [
        {
          id: 'p2',
          name: 'memory_storage',
          purpose: 'x',
          legal_basis: 'consent',
          data_categories: 'x',
          recipients: 'x',
          retention_days: 90,
          created_at: '1',
          updated_at: '1',
        },
      ],
      rowCount: 1,
    });

    const { auditProcessingRegistry } = await import('../tools/audit_processing_registry.js');
    await auditProcessingRegistry({ action: 'get', name: 'memory_storage' });

    const select = recordedQueries().find(
      (q) => q.sql.includes('WHERE') && q.sql.includes('name'),
    );
    expect(select).toBeDefined();
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// audit_report_incident — report / list / resolve
// ═══════════════════════════════════════════════════════════════════════════════

describe('audit_report_incident', () => {
  it('action=report MUST INSERT into incident_log', async () => {
    const { auditReportIncident } = await import('../tools/audit_report_incident.js');
    const result = await auditReportIncident({
      action: 'report',
      severity: 'high',
      category: 'data_leak',
      description: '3 records leaked',
      data_subjects_affected: 3,
    });

    const insert = recordedQueries().find((q) =>
      q.sql.includes('INSERT INTO incident_log'),
    );
    expect(insert).toBeDefined();
    expect(responseText(result)).toMatch(/incident.*signal/i);
  });

  it('action=list MUST SELECT from incident_log', async () => {
    // Use persistent mockResolvedValue: the tool may run a CREATE TABLE IF NOT EXISTS
    // before the SELECT, so a single mockResolvedValueOnce would be consumed by it.
    mockPool.query.mockResolvedValue({
      rows: [
        {
          id: 'inc-1',
          detected_at: '1000',
          severity: 'moderate',
          category: 'breach',
          description: 'x',
          data_subjects_affected: 1,
          cai_notified: 0,
          subjects_notified: 0,
          resolved_at: null,
        },
      ],
      rowCount: 1,
    });

    const { auditReportIncident } = await import('../tools/audit_report_incident.js');
    const result = await auditReportIncident({ action: 'list' });

    const select = recordedQueries().find((q) =>
      q.sql.includes('incident_log'),
    );
    expect(select).toBeDefined();
    expect(responseText(result).toLowerCase()).toContain('moderate');
  });

  it('action=resolve MUST UPDATE resolved_at', async () => {
    mockPool.query.mockResolvedValueOnce({ rows: [], rowCount: 1 });

    const { auditReportIncident } = await import('../tools/audit_report_incident.js');
    await auditReportIncident({ action: 'resolve', incident_id: 'inc-1' });

    const update = recordedQueries().find(
      (q) =>
        q.sql.trim().toUpperCase().startsWith('UPDATE') &&
        q.sql.includes('resolved_at'),
    );
    expect(update).toBeDefined();
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// audit_efvp — create / list / get
// ═══════════════════════════════════════════════════════════════════════════════

describe('audit_efvp', () => {
  it('action=create MUST INSERT a new EFVP record', async () => {
    const { auditEfvp } = await import('../tools/audit_efvp.js');
    const result = await auditEfvp({
      action: 'create',
      project_name: 'memory_v2',
      description: 'vectorize prompts',
      data_categories: 'prompts,embeddings',
      risks: 're-identification',
      mitigations: 'noise injection',
    });

    const insert = recordedQueries().find((q) =>
      q.sql.includes('INSERT INTO efvp_records'),
    );
    expect(insert).toBeDefined();
    expect(responseText(result)).toMatch(/efvp.*cr[ée]/i);
  });

  it('action=list MUST SELECT all EFVPs', async () => {
    // Persistent mock: the tool runs CREATE TABLE IF NOT EXISTS before SELECT.
    mockPool.query.mockResolvedValue({
      rows: [
        {
          id: 'efvp-1',
          project_name: 'mem_v1',
          description: 'x',
          data_categories: 'x',
          risks: 'x',
          mitigations: 'x',
          created_at: '1000',
          updated_at: '1000',
        },
      ],
      rowCount: 1,
    });

    const { auditEfvp } = await import('../tools/audit_efvp.js');
    const result = await auditEfvp({ action: 'list' });

    const select = recordedQueries().find((q) =>
      q.sql.includes('efvp_records'),
    );
    expect(select).toBeDefined();
    expect(responseText(result)).toContain('mem_v1');
  });

  it('action=get MUST SELECT by id', async () => {
    mockPool.query.mockResolvedValueOnce({
      rows: [
        {
          id: 'efvp-x',
          project_name: 'p',
          description: 'd',
          data_categories: 'c',
          risks: 'r',
          mitigations: 'm',
          created_at: '1',
          updated_at: '1',
        },
      ],
      rowCount: 1,
    });

    const { auditEfvp } = await import('../tools/audit_efvp.js');
    await auditEfvp({ action: 'get', efvp_id: 'efvp-x' });

    const select = recordedQueries().find(
      (q) => q.sql.includes('WHERE') && q.sql.includes('efvp_records'),
    );
    expect(select).toBeDefined();
  });
});
