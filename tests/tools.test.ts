import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createAgent } from '../src/tools/create_agent.js';
import { listAgents, deleteAgent, updateAgentConfig } from '../src/tools/manage_agents.js';
import { createPrompt, editPrompt } from '../src/tools/manage_prompts.js';
import { runClaudeAgent } from '../src/tools/run_claude.js';

import { AgentManager } from '../src/services/AgentManager.js';
import { PromptManager } from '../src/services/PromptManager.js';
import { ClaudeRunner } from '../src/services/ClaudeRunner.js';

describe('MCP Tools Unit Tests', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    vi.spyOn(AgentManager.prototype, 'createAgent').mockResolvedValue({ promptPath: '/tmp/p.md', settingsPath: '/tmp/s.json', error: undefined } as any);
    vi.spyOn(AgentManager.prototype, 'listAgents').mockResolvedValue(['- agent1'] as any);
    vi.spyOn(AgentManager.prototype, 'deleteAgent').mockResolvedValue({ deletedFiles: ['/tmp/p.md'], errors: [] } as any);
    vi.spyOn(AgentManager.prototype, 'updateAgentConfig').mockResolvedValue(['- Modèle : old -> new']);

    vi.spyOn(PromptManager.prototype, 'createPrompt').mockResolvedValue({ filePath: '/tmp/p.md', existed: false } as any);
    vi.spyOn(PromptManager.prototype, 'editPrompt').mockResolvedValue({ success: true } as any);

    vi.spyOn(ClaudeRunner.prototype, 'runAgent').mockResolvedValue({ result: 'Hello', sessionId: '123' } as any);
  });

  it('createAgent creates an agent successfully', async () => {
    const res = await createAgent({ name: 'test_agent', prompt: 'hello', model: 'claude-sonnet' });
    expect(res.content[0].text).toContain("Agent 'test_agent' créé avec succès");
  });

  it('listAgents lists agents', async () => {
    const res = await listAgents({ details: false });
    expect(res.content[0].text).toContain('- agent1');
  });

  it('deleteAgent deletes an agent', async () => {
    const res = await deleteAgent({ name: 'test_agent' });
    expect(res.content[0].text).toContain("Suppression de l'agent 'test_agent'");
  });

  it('updateAgentConfig updates config', async () => {
    const res = await updateAgentConfig({ name: 'test_agent', model: 'new' });
    expect(res.content[0].text).toContain("Configuration de l'agent 'test_agent' mise à jour");
  });

  it('createPrompt creates a prompt', async () => {
    const res = await createPrompt({ name: 'test_prompt', content: 'test' });
    expect(res.content[0].text).toContain("Prompt 'test_prompt' créé avec succès.");
  });

  it('editPrompt edits a prompt', async () => {
    const res = await editPrompt({ name: 'test_prompt', search: 'test', replace: 'newtest' });
    expect(res.content[0].text).toContain("Prompt 'test_prompt' modifié avec succès.");
  });

  it('runClaudeAgent runs an agent', async () => {
    const res = await runClaudeAgent({ prompt: 'hello', autoResume: false });
    expect(res.content[0].text).toBe('Hello');
    expect(res.content[1].text).toContain('123');
  });
});
