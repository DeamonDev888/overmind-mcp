import type { Context } from '@temporalio/activity';

export interface RunAgentActivityInput {
  runner: string;
  prompt: string;
  agentName?: string;
  model?: string;
  path?: string;
}

export interface RunAgentActivityOutput {
  success: boolean;
  result?: string;
  error?: string;
}

export async function runAgentActivity(
  input: RunAgentActivityInput,
  _context: Context,
): Promise<RunAgentActivityOutput> {
  const { runAgent } = await import('../../../tools/run_agent.js');
  const res = await runAgent({
    runner: input.runner as Parameters<typeof runAgent>[0]['runner'],
    prompt: input.prompt,
    agentName: input.agentName,
    model: input.model,
    path: input.path,
    autoResume: false,
    silent: false,
  });
  return {
    success: !res.isError,
    result: res.content?.[0]?.text,
    error: res.isError ? res.content?.[0]?.text : undefined,
  };
}
