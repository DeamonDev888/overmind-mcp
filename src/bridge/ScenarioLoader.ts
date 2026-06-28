/**
 * ╔══════════════════════════════════════════════════════════════════════╗
 * ║   OVERMIND BRIDGE — ScenarioLoader (Multi-Agent Orchestration)      ║
 * ║                                                                      ║
 * ║   Charge un scénario depuis YAML/JSON qui décrit un workflow        ║
 * ║   multi-agents : séquentiel, parallèle, conditionnel, A2A.          ║
 * ║                                                                      ║
 * ║   FORMAT JSON                                                         ║
 * ║   ──────────                                                         ║
 * ║   {                                                                   ║
 * ║     "name": "My workflow",                                            ║
 * ║     "vars": { "ticker": "BTC" },                                      ║
 * ║     "steps": [                                                        ║
 * ║       { "id": "step1", "type": "run", "agent": "scout",              ║
 * ║         "runner": "kilo", "prompt": "Analyse ${ticker}" },            ║
 * ║       { "id": "step2", "type": "a2a", "from": "scout", "to":         ║
 * ║         "analyst", "prompt": "Valide ${step1.output}" },              ║
 * ║       { "id": "step3", "type": "parallel", "steps": [...] }           ║
 * ║     ]                                                                 ║
 * ║   }                                                                   ║
 * ╚══════════════════════════════════════════════════════════════════════╝
 */

import fs from 'node:fs/promises';
import { interpolate } from './utils.js';

// ─── Lazy YAML loader (optionnel) ──────────────────────────────────────────
//
// YAML est supporté si le module `yaml` est installé.
// Sinon on throw une erreur claire demandant `npm i yaml`.
//
// On utilise createRequire pour rester compatible ESM (NodeNext).

import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);

function tryLoadYaml(): ((input: string) => unknown) | undefined {
  try {
    const yaml = require('yaml') as { parse: (s: string) => unknown };
    return yaml.parse;
  } catch {
    return undefined;
  }
}

// ─── Public Types ──────────────────────────────────────────────────────────

export type ScenarioStep =
  | RunStep
  | A2AStep
  | ParallelStep
  | ConditionalStep
  | WaitStep
  | KanbanStep;

export interface RunStep {
  id: string;
  type: 'run';
  agent: string;
  runner: string;
  prompt: string;
  model?: string;
  mode?: string;
  path?: string;
  /** Output saved as ${stepId.output} pour les steps suivants */
  outputVar?: string;
  /** Si true, arrête le scénario si ce step échoue */
  stopOnError?: boolean;
}

export interface A2AStep {
  id: string;
  type: 'a2a';
  from: string;
  to: string;
  runner: string;
  prompt: string;
  model?: string;
  outputVar?: string;
  stopOnError?: boolean;
}

export interface ParallelStep {
  id: string;
  type: 'parallel';
  steps: ScenarioStep[];
  waitAll?: boolean; // default: true
  outputVar?: string;
}

export interface ConditionalStep {
  id: string;
  type: 'if';
  /** Expression simple : ${var} == "value" ou ${var} (truthy) */
  condition: string;
  then: ScenarioStep[];
  else?: ScenarioStep[];
}

export interface WaitStep {
  id: string;
  type: 'wait';
  ms: number;
}

/**
 * Kanban Step (v3.0) — Durable task via Hermes Kanban.
 *
 * Creates a Kanban task, optionally waits for completion, and exposes
 * the result as ${stepId.output}. If the server crashes, the Kanban
 * task survives and can be reclaimed automatically.
 */
export interface KanbanStep {
  id: string;
  type: 'kanban';
  assignee: string;        // Hermes profile name
  title: string;
  body?: string;           // defaults to interpolated from vars
  tenant?: string;
  wait?: boolean;          // default: true — wait for completion
  timeoutMs?: number;      // default: 600000 (10min)
  /** Output saved as ${stepId.output} */
  outputVar?: string;
}

export interface Scenario {
  name: string;
  description?: string;
  vars?: Record<string, string>;
  steps: ScenarioStep[];
}

export interface StepResult {
  stepId: string;
  type: string;
  success: boolean;
  output?: unknown;
  error?: string;
  durationMs: number;
}

// ─── Loader ────────────────────────────────────────────────────────────────

/**
 * Charge un scénario depuis un fichier. Supporte JSON et YAML.
 */
export async function loadScenario(filePath: string): Promise<Scenario> {
  const raw = await fs.readFile(filePath, 'utf-8');
  const ext = filePath.toLowerCase().split('.').pop() ?? 'json';

  let parsed: unknown;
  if (ext === 'yaml' || ext === 'yml') {
    const parseYaml = tryLoadYaml();
    if (!parseYaml) {
      throw new Error(
        `YAML scenario requested but 'yaml' module is not installed.\n` +
          `Install it with: npm install yaml\n` +
          `Or convert your scenario to JSON (.json) which is supported out-of-the-box.`,
      );
    }
    try {
      parsed = parseYaml(raw);
    } catch (err) {
      throw new Error(`Invalid YAML in ${filePath}: ${(err as Error).message}`, { cause: err });
    }
  } else {
    try {
      parsed = JSON.parse(raw);
    } catch (err) {
      throw new Error(`Invalid JSON in ${filePath}: ${(err as Error).message}`, { cause: err });
    }
  }

  return validateScenario(parsed);
}

/**
 * Valide et normalise un objet scénario.
 */
function validateScenario(obj: unknown): Scenario {
  if (!obj || typeof obj !== 'object') {
    throw new Error('Scenario must be an object');
  }
  const s = obj as Record<string, unknown>;
  if (typeof s.name !== 'string' || !s.name) {
    throw new Error('Scenario.name is required');
  }
  if (!Array.isArray(s.steps)) {
    throw new Error('Scenario.steps must be an array');
  }
  for (const [i, step] of s.steps.entries()) {
    validateStep(step, `steps[${i}]`);
  }
  return {
    name: s.name,
    description: typeof s.description === 'string' ? s.description : undefined,
    vars: (s.vars as Record<string, string>) ?? {},
    steps: s.steps as ScenarioStep[],
  };
}

function validateStep(step: unknown, path: string): void {
  if (!step || typeof step !== 'object') {
    throw new Error(`${path} must be an object`);
  }
  const s = step as Record<string, unknown>;
  if (typeof s.id !== 'string' || !s.id) {
    throw new Error(`${path}.id is required`);
  }
  const type = s.type;
  if (type === 'run') {
    if (typeof s.agent !== 'string') throw new Error(`${path}.agent required for run`);
    if (typeof s.runner !== 'string') throw new Error(`${path}.runner required for run`);
    if (typeof s.prompt !== 'string') throw new Error(`${path}.prompt required for run`);
  } else if (type === 'a2a') {
    if (typeof s.from !== 'string') throw new Error(`${path}.from required for a2a`);
    if (typeof s.to !== 'string') throw new Error(`${path}.to required for a2a`);
    if (typeof s.runner !== 'string') throw new Error(`${path}.runner required for a2a`);
    if (typeof s.prompt !== 'string') throw new Error(`${path}.prompt required for a2a`);
  } else if (type === 'parallel') {
    if (!Array.isArray(s.steps)) throw new Error(`${path}.steps required for parallel`);
    s.steps.forEach((sub, j) => validateStep(sub, `${path}.steps[${j}]`));
  } else if (type === 'if') {
    if (typeof s.condition !== 'string') throw new Error(`${path}.condition required for if`);
    if (!Array.isArray(s.then)) throw new Error(`${path}.then required for if`);
    s.then.forEach((sub, j) => validateStep(sub, `${path}.then[${j}]`));
    if (s.else && Array.isArray(s.else)) {
      s.else.forEach((sub, j) => validateStep(sub, `${path}.else[${j}]`));
    }
  } else if (type === 'wait') {
    if (typeof s.ms !== 'number') throw new Error(`${path}.ms required for wait`);
  } else if (type === 'kanban') {
    if (typeof s.assignee !== 'string') throw new Error(`${path}.assignee required for kanban`);
    if (typeof s.title !== 'string') throw new Error(`${path}.title required for kanban`);
  } else {
    throw new Error(`${path}.type must be one of: run, a2a, parallel, if, wait (got: ${String(type)})`);
  }
}

// ─── Scenario Runner ───────────────────────────────────────────────────────

export interface ScenarioRunnerContext {
  /** Variables partagées (input vars + outputs des steps précédents) */
  vars: Record<string, string>;
  /** Fonction qui exécute un appel agent.run (retourne le text) */
  runAgent: (params: {
    agentName: string;
    runner: string;
    prompt: string;
    model?: string;
    mode?: string;
    path?: string;
  }) => Promise<{ text: string; sessionId?: string; isError: boolean; messageId?: string }>;
  /** Fonction qui exécute un appel agent.a2a */
  runA2A: (params: {
    fromAgent: string;
    toAgent: string;
    runner: string;
    prompt: string;
    model?: string;
  }) => Promise<{ text: string; sessionId?: string; isError: boolean; messageId?: string }>;
  /** Logger */
  log?: (msg: string) => void;
}

/**
 * Exécute un scénario séquentiellement. Retourne tous les résultats.
 */
export async function runScenario(
  scenario: Scenario,
  ctx: ScenarioRunnerContext,
): Promise<StepResult[]> {
  // Init vars (input + step outputs)
  const vars: Record<string, string> = { ...(scenario.vars ?? {}) };
  const localCtx: ScenarioRunnerContext = { ...ctx, vars };
  const results: StepResult[] = [];

  for (const step of scenario.steps) {
    const result = await runStep(step, localCtx);
    results.push(result);
    if (result.output !== undefined) {
      // Expose output aux steps suivants : ${stepId.output} et ${stepId}
      const outputStr = typeof result.output === 'string' ? result.output : JSON.stringify(result.output);
      localCtx.vars[result.stepId] = outputStr;
      localCtx.vars[`${result.stepId}.output`] = outputStr;
    }
    if (!result.success && (step as RunStep).stopOnError) {
      break;
    }
  }
  return results;
}

async function runStep(step: ScenarioStep, ctx: ScenarioRunnerContext): Promise<StepResult> {
  const startTime = Date.now();
  const log = ctx.log ?? (() => {});

  try {
    switch (step.type) {
      case 'run': {
        const prompt = interpolate(step.prompt, ctx.vars);
        log(`▶ [${step.id}] run ${step.agent} (${step.runner})`);
        const r = await ctx.runAgent({
          agentName: step.agent,
          runner: step.runner,
          prompt,
          model: step.model,
          mode: step.mode,
          path: step.path,
        });
        log(r.isError ? `✗ [${step.id}] failed` : `✓ [${step.id}] done (${Date.now() - startTime}ms)`);
        return {
          stepId: step.id,
          type: 'run',
          success: !r.isError,
          output: r.text,
          durationMs: Date.now() - startTime,
        };
      }

      case 'a2a': {
        const prompt = interpolate(step.prompt, ctx.vars);
        log(`▶ [${step.id}] a2a ${step.from} → ${step.to}`);
        const r = await ctx.runA2A({
          fromAgent: step.from,
          toAgent: step.to,
          runner: step.runner,
          prompt,
          model: step.model,
        });
        log(r.isError ? `✗ [${step.id}] failed` : `✓ [${step.id}] done (${Date.now() - startTime}ms)`);
        return {
          stepId: step.id,
          type: 'a2a',
          success: !r.isError,
          output: r.text,
          durationMs: Date.now() - startTime,
        };
      }

      case 'parallel': {
        const waitAll = step.waitAll ?? true;
        log(`▶ [${step.id}] parallel (${step.steps.length} steps, waitAll=${waitAll})`);
        let subResults: StepResult[];
        if (waitAll) {
          subResults = await Promise.all(step.steps.map((s) => runStep(s, ctx)));
        } else {
          // waitAll=false : retourne dès qu'un step réussit
          // On lance tout, et on retourne au premier succès (les autres continuent en background)
          const promises = step.steps.map((s) => runStep(s, ctx));
          // Promise.any retourne le 1er à RÉSOUDRE (donc succès, car on catch les erreurs dans runStep)
          const first = await Promise.any(promises);
          // Cancel le reste en best-effort (ils continuent mais on n'attend pas)
          subResults = [first];
        }
        const success = subResults.every((r) => r.success);
        return {
          stepId: step.id,
          type: 'parallel',
          success,
          output: subResults,
          durationMs: Date.now() - startTime,
        };
      }

      case 'if': {
        const condStr = interpolate(step.condition, ctx.vars);
        const truthy = evaluateCondition(condStr);
        log(`▶ [${step.id}] if (${condStr}) → ${truthy ? 'then' : 'else'}`);
        const branch = truthy ? step.then : (step.else ?? []);
        const subResults: StepResult[] = [];
        for (const s of branch) {
          subResults.push(await runStep(s, ctx));
        }
        return {
          stepId: step.id,
          type: 'if',
          success: subResults.every((r) => r.success),
          output: subResults,
          durationMs: Date.now() - startTime,
        };
      }

      case 'wait': {
        log(`▶ [${step.id}] wait ${step.ms}ms`);
        await new Promise((resolve) => setTimeout(resolve, step.ms));
        return {
          stepId: step.id,
          type: 'wait',
          success: true,
          durationMs: Date.now() - startTime,
        };
      }

      case 'kanban': {
        const title = interpolate(step.title, ctx.vars);
        const body = step.body ? interpolate(step.body, ctx.vars) : title;
        const shouldWait = step.wait !== false; // default: true
        log(`▶ [${step.id}] kanban → ${step.assignee}: "${title}"`);

        // Dynamic import to avoid circular dependency
        const { KanbanAdapter } = await import('../services/KanbanAdapter.js');
        const kanban = new KanbanAdapter();

        const { taskId } = await kanban.createTask({
          title,
          assignee: step.assignee,
          body,
          tenant: step.tenant,
        });

        if (!shouldWait) {
          log(`✓ [${step.id}] kanban task created (fire-and-forget): ${taskId}`);
          return {
            stepId: step.id,
            type: 'kanban',
            success: true,
            output: `kanban:${taskId}`,
            durationMs: Date.now() - startTime,
          };
        }

        const result = await kanban.wait(taskId, step.timeoutMs || 600000);
        log(result.status === 'done'
          ? `✓ [${step.id}] kanban done (${Date.now() - startTime}ms)`
          : `✗ [${step.id}] kanban ${result.status}: ${result.error || ''}`
        );

        return {
          stepId: step.id,
          type: 'kanban',
          success: result.status === 'done',
          output: result.summary || result.error || `kanban:${taskId}`,
          durationMs: Date.now() - startTime,
        };
      }

      default: {
        const _exhaustive: never = step;
        throw new Error(`Unknown step type: ${JSON.stringify(_exhaustive)}`);
      }
    }
  } catch (err) {
    log(`💥 [${step.id}] crashed: ${(err as Error).message}`);
    return {
      stepId: step.id,
      type: (step as { type: string }).type,
      success: false,
      error: (err as Error).message,
      durationMs: Date.now() - startTime,
    };
  }
}

/**
 * Évalue une condition simple. Supporte :
 *   - "value" (truthy si non-vide)
 *   - ${var} == "literal"
 *   - ${var} != "literal"
 *   - ${var} > 5, < 5
 *   - ${var} && ${other}
 *   - !${var}
 */
function evaluateCondition(expr: string): boolean {
  const trimmed = expr.trim();
  if (!trimmed) return false;

  // ${var} == "literal"
  let m = trimmed.match(/^(.+?)\s*==\s*["']([^"']*)["']$/);
  if (m) return m[1].trim() === m[2];

  // ${var} != "literal"
  m = trimmed.match(/^(.+?)\s*!=\s*["']([^"']*)["']$/);
  if (m) return m[1].trim() !== m[2];

  // ${var} > N
  m = trimmed.match(/^(.+?)\s*>\s*(\d+(?:\.\d+)?)$/);
  if (m) return Number(m[1].trim()) > Number(m[2]);

  // ${var} < N
  m = trimmed.match(/^(.+?)\s*<\s*(\d+(?:\.\d+)?)$/);
  if (m) return Number(m[1].trim()) < Number(m[2]);

  // !${var}
  if (trimmed.startsWith('!')) return !evaluateCondition(trimmed.slice(1));

  // ${a} && ${b}
  if (trimmed.includes('&&')) {
    return trimmed
      .split('&&')
      .map((p) => evaluateCondition(p.trim()))
      .every(Boolean);
  }

  // ${a} || ${b}
  if (trimmed.includes('||')) {
    return trimmed
      .split('||')
      .map((p) => evaluateCondition(p.trim()))
      .some(Boolean);
  }

  // Truthy simple
  return Boolean(trimmed);
}
