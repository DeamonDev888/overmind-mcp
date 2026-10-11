/**
 * Anti-régression — purge des outils audit_* (2026-10-10).
 *
 * Garantit que :
 *  1. server.ts n'importe ni n'enregistre aucun outil audit_*
 *  2. Les fichiers src/tools/audit_*.ts et src/lib/audit/ ont disparu du repo
 *  3. L'INSERT agent_runs de PostgresMemoryProvider est aligné sur le DDL
 *     (aucune colonne audit — corrige le mismatch INSERT/DDL latent qui
 *     cassait les nouvelles DB d'agents)
 *  4. AgentManager.updateAgentConfig avec runner='hermes' emprunte la branche
 *     profil même si `hermes profile list` échoue (fix isHermes)
 */

import { describe, it, expect, vi } from 'vitest';
import { readFileSync, existsSync } from 'fs';

const SERVER_SRC = readFileSync(new URL('../server.ts', import.meta.url), 'utf-8');
const MEMORY_SRC = readFileSync(
  new URL('../memory/PostgresMemoryProvider.ts', import.meta.url),
  'utf-8',
);

const EXPECTED_TOOLS = [
  'run_agent',
  'run_agents_parallel',
  'memory_search',
  'memory_store',
  'memory_runs',
  'create_agent',
  'create_prompt',
  'edit_prompt',
  'list_agents',
  'delete_agent',
  'update_agent_config',
  'get_agent_configs',
  'config_example',
  'agent_control',
  'a2a_hub',
  'get_metrics',
];

// Mocks dynamiques pour AgentManager (fix isHermes)
const { mockList, mockGetProfilePath, mockUpdate } = vi.hoisted(() => ({
  mockList: vi.fn(async () => []),
  mockGetProfilePath: vi.fn(async () => 'C:\\fake\\profiles\\test'),
  mockUpdate: vi.fn(async () => {}),
}));

vi.mock('../services/HermesProfileManager.js', () => ({
  HermesProfileManager: {
    list: mockList,
    getProfilePath: mockGetProfilePath,
    update: mockUpdate,
    delete: vi.fn(),
  },
}));

// Évite le chargement de overmind-postgres-mcp (config.js fait process.exit(1)
// sans OPENROUTER_API_KEY — hors sujet pour ces tests).
vi.mock('overmind-postgres-mcp', () => ({
  getPool: vi.fn(() => ({ query: vi.fn(), connect: vi.fn() })),
}));
vi.mock('overmind-postgres-mcp/services/embeddings', () => ({
  embedText: vi.fn(async () => []),
}));

describe('Purge audit — server sans outils audit_*', () => {
  it('server.ts n\'importe aucun module tools/audit_*', () => {
    expect(SERVER_SRC).not.toMatch(/tools\/audit_/);
  });

  it('server.ts n\'enregistre aucun addTool nommé audit_*', () => {
    expect(SERVER_SRC).not.toMatch(/name: 'audit_/);
  });

  it('server.ts expose exactement les 16 outils attendus', () => {
    const toolNames = [...SERVER_SRC.matchAll(/name: '([a-z0-9_]+)',/g)].map((m) => m[1]);
    for (const t of EXPECTED_TOOLS) {
      expect(toolNames).toContain(t);
    }
    expect(toolNames.some((t) => t.startsWith('audit_'))).toBe(false);
  });

  it('les fichiers tools/audit_*.ts ont disparu du repo', () => {
    for (const f of [
      'audit_access_request',
      'audit_consent',
      'audit_efvp',
      'audit_erasure',
      'audit_processing_registry',
      'audit_rectification',
      'audit_report_incident',
    ]) {
      expect(existsSync(new URL(`../tools/${f}.ts`, import.meta.url))).toBe(false);
    }
  });

  it('le répertoire lib/audit a disparu du repo', () => {
    expect(existsSync(new URL('../lib/audit/types.ts', import.meta.url))).toBe(false);
    expect(existsSync(new URL('../lib/audit/guard.ts', import.meta.url))).toBe(false);
    expect(existsSync(new URL('../lib/audit/runner_hook.ts', import.meta.url))).toBe(false);
  });
});

describe('PostgresMemoryProvider — INSERT agent_runs aligné sur le DDL', () => {
  it('chaque colonne du INSERT existe dans le CREATE TABLE', () => {
    const ddlMatch = MEMORY_SRC.match(/CREATE TABLE IF NOT EXISTS agent_runs \(([\s\S]*?)\)\s*`/);
    expect(ddlMatch).toBeTruthy();
    const ddlCols = [...ddlMatch![1].matchAll(/^\s*(\w+)\s+/gm)].map((m) => m[1]);

    const insertMatch = MEMORY_SRC.match(/INSERT INTO agent_runs\s*\(([\s\S]*?)\)\s*VALUES/);
    expect(insertMatch).toBeTruthy();
    const insertCols = insertMatch![1]
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);

    expect(insertCols.length).toBeGreaterThan(0);
    for (const col of insertCols) {
      expect(ddlCols, `colonne ${col} absente du DDL`).toContain(col);
    }
  });

  it('aucune colonne audit (data_subject_id, created_for...) dans le INSERT', () => {
    const insertMatch = MEMORY_SRC.match(/INSERT INTO agent_runs\s*\(([\s\S]*?)\)\s*VALUES/);
    const insertCols = insertMatch![1]
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);

    expect(insertCols).not.toContain('data_subject_id');
    expect(insertCols).not.toContain('legal_basis');
    expect(insertCols).not.toContain('consent_ref');
    expect(insertCols).not.toContain('retention_expires_at');
    expect(insertCols).not.toContain('created_for');
  });
});

describe('AgentManager.updateAgentConfig — fix isHermes', () => {
  it('runner=hermes force la branche profil même si list() est vide', async () => {
    const { AgentManager } = await import('../services/AgentManager.js');
    const manager = new AgentManager();

    const changes = await manager.updateAgentConfig('hermes_test_agent', {
      model: 'MiniMax-M3',
      runner: 'hermes',
    });

    expect(mockUpdate).toHaveBeenCalledWith(
      'hermes_test_agent',
      expect.objectContaining({ model: 'MiniMax-M3' }),
    );
    expect(changes.some((c) => c.includes('Modèle'))).toBe(true);
  });

  it('sans runner hermes et profil inconnu → fallback settings.json explicite', async () => {
    const { AgentManager } = await import('../services/AgentManager.js');
    const manager = new AgentManager();

    await expect(
      manager.updateAgentConfig('zz_no_such_agent_xyz', { model: 'some-model' }),
    ).rejects.toThrow(/settings_zz_no_such_agent_xyz\.json est introuvable/);
  });
});
