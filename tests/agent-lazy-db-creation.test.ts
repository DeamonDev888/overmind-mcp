import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Client } from 'pg';
import { PostgresMemoryProvider } from '../src/memory/PostgresMemoryProvider.js';

/**
 * Test Suite: Agent Creation - Lazy Database Creation Validation
 *
 * VALIDATES QUE: Lors de la création d'un agent, sa DB PostgreSQL
 * individuelle est créée automatiquement lors du PREMIER appel.
 *
 * Ce test répond à la question: "lors de la creation d un agent le code
 * source a t il creer sa db individuel de memoire ?"
 *
 * Réponse: NON - La DB n'est pas créée lors de la création de l'agent,
 * mais lors du PREMIER appel à une fonction de mémoire (lazy creation).
 */
describe('Agent Creation - Lazy DB Creation', () => {
  let provider: PostgresMemoryProvider;
  let maintenanceClient: Client;
  const TEST_AGENT = `test_validation_${Date.now()}`;
  const DB_NAME = `agent_${TEST_AGENT}`;

  beforeAll(async () => {
    provider = new PostgresMemoryProvider();
    maintenanceClient = new Client({
      host: process.env.POSTGRES_HOST || '127.0.0.1',
      port: parseInt(process.env.POSTGRES_PORT || '5432', 10),
      user: process.env.POSTGRES_USER || 'postgres',
      password: process.env.POSTGRES_PASSWORD || '',
      database: 'postgres',
    });
    await maintenanceClient.connect();
  }, 10000);

  afterAll(async () => {
    // Note: DB cleanup is skipped due to active pool connections
    // Test databases will be cleaned up manually or in the next test run
    await maintenanceClient.end().catch(() => {});
  });

  it('VALIDATION: DB is NOT created at agent instantiation', async () => {
    // Création d'un provider (simulation de la création d'un agent)
    // La création d'un provider ne crée pas la DB immédiatement
    new PostgresMemoryProvider();

    // Vérifier que la DB n'existe PAS encore
    const dbCheck = await maintenanceClient.query('SELECT 1 FROM pg_database WHERE datname = $1', [
      DB_NAME,
    ]);

    expect(dbCheck.rows.length).toBe(0);
    console.log('✅ VALIDATED: DB does NOT exist at agent creation');
  });

  it('VALIDATION: DB IS created on first storeKnowledge call', async () => {
    // Premier appel de mémoire pour l'agent
    const knowledgeId = await provider.storeKnowledge({
      text: "Premier savoir de l'agent",
      source: 'test',
      agentName: TEST_AGENT,
    });

    expect(knowledgeId).toMatch(/^k_/);

    // Vérifier que la DB existe MAINTENANT
    const dbCheck = await maintenanceClient.query('SELECT 1 FROM pg_database WHERE datname = $1', [
      DB_NAME,
    ]);

    expect(dbCheck.rows.length).toBe(1);
    console.log(`✅ VALIDATED: DB "${DB_NAME}" created on first memory call`);
  });

  it('VALIDATION: Created DB has correct schema', async () => {
    // Se connecter à la DB de l'agent
    const agentClient = new Client({
      host: process.env.POSTGRES_HOST || '127.0.0.1',
      port: parseInt(process.env.POSTGRES_PORT || '5432', 10),
      user: process.env.POSTGRES_USER || 'postgres',
      password: process.env.POSTGRES_PASSWORD || '',
      database: DB_NAME,
    });

    await agentClient.connect();

    // Vérifier les tables
    const tables = await agentClient.query(`
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = 'public'
      ORDER BY table_name
    `);

    const tableNames = tables.rows.map((r) => r.table_name);

    expect(tableNames).toContain('knowledge_chunks');
    expect(tableNames).toContain('agent_runs');

    // Vérifier les extensions
    const extensions = await agentClient.query(`
      SELECT extname FROM pg_extension
      ORDER BY extname
    `);

    const extNames = extensions.rows.map((r) => r.extname);
    expect(extNames).toContain('vector');

    await agentClient.end();

    console.log(
      '✅ VALIDATED: DB schema is correct (knowledge_chunks, agent_runs, vector extension)',
    );
  });

  it('VALIDATION: Knowledge is stored in correct agent DB', async () => {
    const testText = "Test d'isolement de mémoire";

    const id = await provider.storeKnowledge({
      text: testText,
      source: 'validation',
      agentName: TEST_AGENT,
    });

    // Vérifier directement dans la DB PostgreSQL
    const agentClient = new Client({
      host: process.env.POSTGRES_HOST || '127.0.0.1',
      port: parseInt(process.env.POSTGRES_PORT || '5432', 10),
      user: process.env.POSTGRES_USER || 'postgres',
      password: process.env.POSTGRES_PASSWORD || '',
      database: DB_NAME,
    });

    await agentClient.connect();

    const result = await agentClient.query(
      'SELECT text, source FROM knowledge_chunks WHERE id = $1',
      [id],
    );

    expect(result.rows.length).toBe(1);
    expect(result.rows[0].text).toBe(testText);
    expect(result.rows[0].source).toBe(`agent|${TEST_AGENT}`);

    await agentClient.end();

    console.log('✅ VALIDATED: Knowledge correctly stored in agent-specific DB');
  });

  it('VALIDATION: DB creation is lazy (on-demand)', async () => {
    const NEW_AGENT = `test_lazy_${Date.now()}`;
    const NEW_DB = `agent_${NEW_AGENT}`;

    // Vérifier que la DB n'existe pas
    const beforeCheck = await maintenanceClient.query(
      'SELECT 1 FROM pg_database WHERE datname = $1',
      [NEW_DB],
    );
    expect(beforeCheck.rows.length).toBe(0);

    // Déclencher la création
    await provider.storeKnowledge({
      text: 'Lazy creation test',
      source: 'test',
      agentName: NEW_AGENT,
    });

    // Vérifier que la DB existe maintenant
    const afterCheck = await maintenanceClient.query(
      'SELECT 1 FROM pg_database WHERE datname = $1',
      [NEW_DB],
    );
    expect(afterCheck.rows.length).toBe(1);

    // Note: Cleanup de NEW_DB ignoré - sera nettoyé manuellement ou au prochain run
    // car les connexions du pool empêchent la suppression immédiate

    console.log('✅ VALIDATED: DB creation is truly lazy (on-demand)');
  });
});
