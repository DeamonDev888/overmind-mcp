import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'fs';
import path from 'path';
import { randomBytes } from 'crypto';
import {
  sessionManager,
  sessionManagerSchema,
} from '../tools/session_manager.js';

describe('Session Manager Tool', () => {
  let tempDir: string;
  let sessionsPath: string;

  beforeEach(async () => {
    // Créer un répertoire temporaire pour les tests
    tempDir = path.join(
      process.env.TMPDIR || process.env.TEMP || '/tmp',
      `session-test-${randomBytes(8).toString('hex')}`,
    );
    await fs.mkdir(tempDir, { recursive: true });
    sessionsPath = path.join(tempDir, '.claude', 'sessions.json');
  });

  afterEach(async () => {
    // Nettoyer le répertoire temporaire
    try {
      await fs.rm(tempDir, { recursive: true, force: true });
    } catch (_e) {
      // Ignorer les erreurs de nettoyage
    }
  });

  describe('Action: list', () => {
    it('should return empty message when no sessions exist', async () => {
      const result = await sessionManager({
        action: 'list',
        workspaceDir: tempDir,
      });

      expect(result).toContain('Aucune session trouvée');
    });

    it('should list sessions grouped by runner', async () => {
      // Créer des sessions de test
      const sessionsData = {
        'claude:agent1': { id: 'session-1', ts: Date.now() },
        'kilo:agent2': { id: 'session-2', ts: Date.now() },
        agent3: { id: 'session-3', ts: Date.now() },
      };

      await fs.mkdir(path.dirname(sessionsPath), { recursive: true });
      await fs.writeFile(sessionsPath, JSON.stringify(sessionsData, null, 2));

      const result = await sessionManager({
        action: 'list',
        workspaceDir: tempDir,
      });

      expect(result).toContain('Sessions trouvées');
      expect(result).toContain('claude');
      expect(result).toContain('kilo');
      expect(result).toContain('Sans runner');
    });

    it('should filter by runner when specified', async () => {
      const sessionsData = {
        'claude:agent1': { id: 'session-1', ts: Date.now() },
        'kilo:agent2': { id: 'session-2', ts: Date.now() },
      };

      await fs.mkdir(path.dirname(sessionsPath), { recursive: true });
      await fs.writeFile(sessionsPath, JSON.stringify(sessionsData, null, 2));

      const result = await sessionManager({
        action: 'list',
        runner: 'claude',
        workspaceDir: tempDir,
      });

      expect(result).toContain('claude');
      expect(result).not.toContain('kilo');
    });

    it('should filter by agent name when specified', async () => {
      const sessionsData = {
        'claude:agent1': { id: 'session-1', ts: Date.now() },
        'claude:agent2': { id: 'session-2', ts: Date.now() },
      };

      await fs.mkdir(path.dirname(sessionsPath), { recursive: true });
      await fs.writeFile(sessionsPath, JSON.stringify(sessionsData, null, 2));

      const result = await sessionManager({
        action: 'list',
        agentName: 'agent1',
        workspaceDir: tempDir,
      });

      expect(result).toContain('agent1');
      expect(result).not.toContain('agent2');
    });
  });

  describe('Action: copy', () => {
    it('should copy session from one agent to another', async () => {
      const sessionsData = {
        'claude:agent1': { id: 'session-1', ts: Date.now() },
      };

      await fs.mkdir(path.dirname(sessionsPath), { recursive: true });
      await fs.writeFile(sessionsPath, JSON.stringify(sessionsData, null, 2));

      const result = await sessionManager({
        action: 'copy',
        sourceAgentName: 'agent1',
        targetAgentName: 'agent2',
        sourceRunner: 'claude',
        targetRunner: 'claude',
        workspaceDir: tempDir,
      });

      expect(result).toContain('Session copiée avec succès');

      // Vérifier que la session a été copiée
      const updatedContent = await fs.readFile(sessionsPath, 'utf-8');
      const sessions = JSON.parse(updatedContent);
      expect(sessions['claude:agent2']).toBeDefined();
    });

    it('should return error if source session does not exist', async () => {
      const result = await sessionManager({
        action: 'copy',
        sourceAgentName: 'nonexistent',
        targetAgentName: 'target',
        workspaceDir: tempDir,
      });

      expect(result).toContain('Session source non trouvée');
    });

    it('should return error if target session already exists', async () => {
      const sessionsData = {
        'claude:agent1': { id: 'session-1', ts: Date.now() },
        'claude:agent2': { id: 'session-2', ts: Date.now() },
      };

      await fs.mkdir(path.dirname(sessionsPath), { recursive: true });
      await fs.writeFile(sessionsPath, JSON.stringify(sessionsData, null, 2));

      const result = await sessionManager({
        action: 'copy',
        sourceAgentName: 'agent1',
        targetAgentName: 'agent2',
        sourceRunner: 'claude',
        targetRunner: 'claude',
        workspaceDir: tempDir,
      });

      expect(result).toContain('existe déjà');
    });
  });

  describe('Action: delete', () => {
    it('should delete existing session', async () => {
      const sessionsData = {
        'claude:agent1': { id: 'session-1', ts: Date.now() },
      };

      await fs.mkdir(path.dirname(sessionsPath), { recursive: true });
      await fs.writeFile(sessionsPath, JSON.stringify(sessionsData, null, 2));

      const result = await sessionManager({
        action: 'delete',
        agentName: 'agent1',
        runner: 'claude',
        workspaceDir: tempDir,
      });

      expect(result).toContain('Session supprimée avec succès');

      // Vérifier que la session a été supprimée
      const updatedContent = await fs.readFile(sessionsPath, 'utf-8');
      const sessions = JSON.parse(updatedContent);
      expect(sessions['claude:agent1']).toBeUndefined();
    });

    it('should return error if session does not exist', async () => {
      const result = await sessionManager({
        action: 'delete',
        agentName: 'nonexistent',
        workspaceDir: tempDir,
      });

      expect(result).toContain('Session non trouvée');
    });
  });

  describe('Action: rename', () => {
    it('should rename existing session', async () => {
      const sessionsData = {
        'claude:old_name': { id: 'session-1', ts: Date.now() },
      };

      await fs.mkdir(path.dirname(sessionsPath), { recursive: true });
      await fs.writeFile(sessionsPath, JSON.stringify(sessionsData, null, 2));

      const result = await sessionManager({
        action: 'rename',
        oldAgentName: 'old_name',
        newAgentName: 'new_name',
        runner: 'claude',
        workspaceDir: tempDir,
      });

      expect(result).toContain('Session renommée avec succès');

      // Vérifier que la session a été renommée
      const updatedContent = await fs.readFile(sessionsPath, 'utf-8');
      const sessions = JSON.parse(updatedContent);
      expect(sessions['claude:old_name']).toBeUndefined();
      expect(sessions['claude:new_name']).toBeDefined();
    });

    it('should return error if source session does not exist', async () => {
      const result = await sessionManager({
        action: 'rename',
        oldAgentName: 'nonexistent',
        newAgentName: 'new_name',
        workspaceDir: tempDir,
      });

      expect(result).toContain('Session source non trouvée');
    });

    it('should return error if target session already exists', async () => {
      const sessionsData = {
        'claude:agent1': { id: 'session-1', ts: Date.now() },
        'claude:agent2': { id: 'session-2', ts: Date.now() },
      };

      await fs.mkdir(path.dirname(sessionsPath), { recursive: true });
      await fs.writeFile(sessionsPath, JSON.stringify(sessionsData, null, 2));

      const result = await sessionManager({
        action: 'rename',
        oldAgentName: 'agent1',
        newAgentName: 'agent2',
        runner: 'claude',
        workspaceDir: tempDir,
      });

      expect(result).toContain('existe déjà');
    });
  });

  describe('Action: purge', () => {
    it('should purge expired sessions', async () => {
      const thirtyOneDaysAgo = Date.now() - 31 * 24 * 60 * 60 * 1000;
      const sessionsData = {
        'claude:expired': { id: 'session-expired', ts: thirtyOneDaysAgo },
        'claude:active': { id: 'session-active', ts: Date.now() },
      };

      await fs.mkdir(path.dirname(sessionsPath), { recursive: true });
      await fs.writeFile(sessionsPath, JSON.stringify(sessionsData, null, 2));

      const result = await sessionManager({
        action: 'purge',
        workspaceDir: tempDir,
      });

      expect(result).toContain('Purge terminée');
      expect(result).toContain('1');

      // Vérifier que seule la session expirée a été supprimée
      const updatedContent = await fs.readFile(sessionsPath, 'utf-8');
      const sessions = JSON.parse(updatedContent);
      expect(sessions['claude:expired']).toBeUndefined();
      expect(sessions['claude:active']).toBeDefined();
    });

    it('should return message when no expired sessions', async () => {
      const sessionsData = {
        'claude:active': { id: 'session-active', ts: Date.now() },
      };

      await fs.mkdir(path.dirname(sessionsPath), { recursive: true });
      await fs.writeFile(sessionsPath, JSON.stringify(sessionsData, null, 2));

      const result = await sessionManager({
        action: 'purge',
        workspaceDir: tempDir,
      });

      expect(result).toContain('Aucune session expirée à purger');
    });
  });

  describe('Action: stats', () => {
    it('should show session statistics', async () => {
      const thirtyOneDaysAgo = Date.now() - 31 * 24 * 60 * 60 * 1000;
      const sessionsData = {
        'claude:agent1': { id: 'session-1', ts: Date.now() },
        'claude:agent2': { id: 'session-2', ts: thirtyOneDaysAgo },
        'kilo:agent3': { id: 'session-3', ts: Date.now() },
      };

      await fs.mkdir(path.dirname(sessionsPath), { recursive: true });
      await fs.writeFile(sessionsPath, JSON.stringify(sessionsData, null, 2));

      const result = await sessionManager({
        action: 'stats',
        workspaceDir: tempDir,
      });

      expect(result).toContain('Statistiques des sessions');
      expect(result).toContain('Total:** 3 sessions');
      expect(result).toContain('Actives:** 2 sessions');
      expect(result).toContain('Expirées:** 1 session');
      expect(result).toContain('claude');
      expect(result).toContain('kilo');
    });

    it('should filter stats by runner', async () => {
      const sessionsData = {
        'claude:agent1': { id: 'session-1', ts: Date.now() },
        'kilo:agent2': { id: 'session-2', ts: Date.now() },
      };

      await fs.mkdir(path.dirname(sessionsPath), { recursive: true });
      await fs.writeFile(sessionsPath, JSON.stringify(sessionsData, null, 2));

      const result = await sessionManager({
        action: 'stats',
        runner: 'claude',
        workspaceDir: tempDir,
      });

      expect(result).toContain('claude');
      expect(result).not.toContain('kilo');
    });

    it('should return message when no sessions exist', async () => {
      const result = await sessionManager({
        action: 'stats',
        workspaceDir: tempDir,
      });

      expect(result).toContain('Total:** 0 sessions');
    });
  });

  describe('Schema Validation', () => {
    it('should validate list action', () => {
      const result = sessionManagerSchema.safeParse({
        action: 'list',
        runner: 'claude',
        includeExpired: false,
      });

      expect(result.success).toBe(true);
    });

    it('should validate copy action with required parameters', () => {
      const result = sessionManagerSchema.safeParse({
        action: 'copy',
        sourceAgentName: 'agent1',
        targetAgentName: 'agent2',
      });

      expect(result.success).toBe(true);
    });

    it('should validate delete action with required parameters', () => {
      const result = sessionManagerSchema.safeParse({
        action: 'delete',
        agentName: 'agent1',
      });

      expect(result.success).toBe(true);
    });

    it('should validate rename action with required parameters', () => {
      const result = sessionManagerSchema.safeParse({
        action: 'rename',
        oldAgentName: 'old',
        newAgentName: 'new',
      });

      expect(result.success).toBe(true);
    });

    it('should fail validation for copy without required parameters', () => {
      const result = sessionManagerSchema.safeParse({
        action: 'copy',
      });

      expect(result.success).toBe(false);
    });

    it('should fail validation for invalid action', () => {
      const result = sessionManagerSchema.safeParse({
        action: 'invalid',
      });

      expect(result.success).toBe(false);
    });
  });
});