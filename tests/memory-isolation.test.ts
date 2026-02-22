import { describe, it, expect, beforeAll } from 'vitest';
import { PostgresMemoryProvider } from '../src/memory/PostgresMemoryProvider.js';
import { Pool } from 'pg';

/**
 * Test de Protection de la Mémoire d'Agent (Overmind Protocol)
 * Ce test vérifie que le système de mémoire crée et isole correctement 
 * les bases de données par agent.
 */
describe('Overmind Protocol: Agent Isolation & Persistence', () => {
    let provider: PostgresMemoryProvider;
    const testAgentName = 'test_unit_sniper';
    const expectedDbName = 'agent_test_unit_sniper';

    beforeAll(() => {
        // Le fournisseur utilise les variables d'environnement chargées via vitest ou --env-file
        provider = new PostgresMemoryProvider();
    });

    it('should create a dedicated database for a new agent', async () => {
        const testText = "Ceci est une connaissance de test pour l'isolation.";
        
        // 1. Stocker une connaissance pour un agent spécifique
        const id = await provider.storeKnowledge({
            text: testText,
            agentName: testAgentName
        });

        expect(id).toBeDefined();
        expect(id).toContain('k_');

        // 2. Vérifier physiquement l'existence de la base dans Postgres
        // On utilise le pool de maintenance pour interroger pg_database
        const maintenancePool = new Pool({
            host: process.env.POSTGRES_HOST || '127.0.0.1',
            port: parseInt(process.env.POSTGRES_PORT || '5432', 10),
            user: process.env.POSTGRES_USER || 'postgres',
            password: process.env.POSTGRES_PASSWORD,
            database: 'postgres' // Base par défaut pour la maintenance
        });

        const res = await maintenancePool.query(
            "SELECT datname FROM pg_database WHERE datname = $1",
            [expectedDbName]
        );

        await maintenancePool.end();

        expect(res.rows.length).toBe(1);
        expect(res.rows[0].datname).toBe(expectedDbName);
    });

    it('should maintain isolation between core and agent memory', async () => {
        const query = "connaissance de test pour l'isolation";
        
        // Chercher dans l'agent (doit trouver)
        const agentResults = await provider.searchMemory({
            query: query,
            agentName: testAgentName
        });
        
        // Chercher dans core (ne doit pas trouver le souvenir de l'agent)
        const coreResults = await provider.searchMemory({
            query: query
            // pas d'agentName
        });

        expect(agentResults.some(r => r.text.includes(query))).toBe(true);
        expect(coreResults.some(r => r.text.includes(query))).toBe(false);
    });
});
