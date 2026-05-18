import pino from 'pino';

const logger = pino({ name: 'SwarmOrchestrator' });

// ─── Types ─────────────────────────────────────────────────────────────────────

export interface AgentCapability {
  agentName: string;
  runner: string;
  capabilities: string[]; // ['code', 'analysis', 'scraping', 'data-processing']
  maxConcurrentTasks: number;
  currentLoad: number;
  estimatedCompletionTime?: number; // ms
}

export interface SwarmTask {
  id: string;
  type: string;
  prompt: string;
  priority: number; // 1-10, 10 = highest
  estimatedDuration?: number; // ms
  requiresCapabilities: string[];
  agentName?: string; // Optional: force specific agent
  model?: string;
  path?: string;
}

export interface SwarmConfig {
  agents: AgentCapability[];
  tasks: SwarmTask[];
  maxParallelTasks: number;
  enableLoadBalancing: boolean;
  enableTaskPriority: boolean;
}

export interface SwarmAllocation {
  taskId: string;
  agentName: string;
  runner: string;
  estimatedStart: number;
  estimatedCompletion: number;
}

export interface SwarmResult {
  taskId: string;
  status: 'pending' | 'assigned' | 'running' | 'completed' | 'failed';
  agentName?: string;
  result?: unknown;
  error?: string;
  startedAt?: number;
  completedAt?: number;
}

// ─── Swarm Orchestrator ────────────────────────────────────────────────────────

export class SwarmOrchestrator {
  private agents: Map<string, AgentCapability>;
  private taskQueue: SwarmTask[] = [];
  private allocations: Map<string, SwarmAllocation> = new Map();
  private results: Map<string, SwarmResult> = new Map();
  private maxParallelTasks: number;
  private enableLoadBalancing: boolean;
  private enableTaskPriority: boolean;
  private roundRobinIndex: number = 0;

  constructor(config: SwarmConfig) {
    this.agents = new Map();
    config.agents.forEach((agent) => {
      this.agents.set(agent.agentName, agent);
    });

    this.taskQueue = config.tasks.sort((a, b) => b.priority - a.priority);
    this.maxParallelTasks = config.maxParallelTasks;
    this.enableLoadBalancing = config.enableLoadBalancing;
    this.enableTaskPriority = config.enableTaskPriority;

    logger.info(
      {
        agentsCount: this.agents.size,
        tasksCount: this.taskQueue.length,
        maxParallel: this.maxParallelTasks,
      },
      'Swarm Orchestrator initialized',
    );
  }

  // ─── Core Allocation Logic ────────────────────────────────────────────────────

  private findBestAgent(task: SwarmTask): AgentCapability | null {
    // Si la tâche force un agent spécifique
    if (task.agentName) {
      const agent = this.agents.get(task.agentName);
      if (agent && this.canAgentHandleTask(agent, task)) {
        return agent;
      }
      logger.warn({ task: task.id, forcedAgent: task.agentName }, 'Forced agent unavailable or incapable');
      return null;
    }

    // Filtrer les agents capables
    const capableAgents = Array.from(this.agents.values()).filter((agent) =>
      this.canAgentHandleTask(agent, task),
    );

    if (capableAgents.length === 0) {
      logger.warn({ task: task.id, requiredCaps: task.requiresCapabilities }, 'No capable agent found');
      return null;
    }

    // Stratégie d'allocation
    if (this.enableLoadBalancing) {
      return this.selectByLoadBalancing(capableAgents, task);
    } else {
      return this.selectByRoundRobin(capableAgents);
    }
  }

  private canAgentHandleTask(agent: AgentCapability, task: SwarmTask): boolean {
    // Vérifier les capacités requises
    const hasCapabilities = task.requiresCapabilities.every((cap) =>
      agent.capabilities.includes(cap),
    );

    if (!hasCapabilities) {
      return false;
    }

    // Vérifier la charge actuelle
    if (agent.currentLoad >= agent.maxConcurrentTasks) {
      return false;
    }

    return true;
  }

  private selectByLoadBalancing(agents: AgentCapability[], task: SwarmTask): AgentCapability {
    // Stratégie: moindre charge + temps d'achèvement estimé
    return agents.reduce((best, current) => {
      const bestScore = this.calculateAgentScore(best, task);
      const currentScore = this.calculateAgentScore(current, task);
      return currentScore > bestScore ? current : best;
    });
  }

  private selectByRoundRobin(agents: AgentCapability[]): AgentCapability {
    // True round-robin: rotate through available agents
    const index = this.roundRobinIndex % agents.length;
    this.roundRobinIndex++;
    return agents[index];
  }

  private calculateAgentScore(agent: AgentCapability, _task: SwarmTask): number {
    const loadFactor = 1 - agent.currentLoad / agent.maxConcurrentTasks; // 0-1
    const timeFactor = agent.estimatedCompletionTime
      ? 1 / (agent.estimatedCompletionTime + 1)
      : 1;

    return loadFactor * 0.7 + timeFactor * 0.3; // Pondération: 70% charge, 30% temps
  }

  // ─── Task Allocation ───────────────────────────────────────────────────────────

  async allocateTasks(): Promise<SwarmAllocation[]> {
    const allocations: SwarmAllocation[] = [];
    const runningCount = Array.from(this.allocations.values()).filter(
      (a) => !this.results.has(a.taskId) || this.results.get(a.taskId)?.status === 'running',
    ).length;

    if (runningCount >= this.maxParallelTasks) {
      logger.debug({ running: runningCount, max: this.maxParallelTasks }, 'Max parallel tasks reached');
      return allocations;
    }

    const availableSlots = this.maxParallelTasks - runningCount;
    const tasksToAllocate = this.taskQueue
      .filter((t) => !this.allocations.has(t.id))
      .slice(0, availableSlots);

    for (const task of tasksToAllocate) {
      const agent = this.findBestAgent(task);

      if (agent) {
        const allocation: SwarmAllocation = {
          taskId: task.id,
          agentName: agent.agentName,
          runner: agent.runner,
          estimatedStart: Date.now(),
          estimatedCompletion: Date.now() + (task.estimatedDuration || 60000),
        };

        this.allocations.set(task.id, allocation);
        agent.currentLoad++;

        this.results.set(task.id, {
          taskId: task.id,
          status: 'assigned',
          agentName: agent.agentName,
          startedAt: allocation.estimatedStart,
        });

        allocations.push(allocation);

        logger.info(
          {
            task: task.id,
            agent: agent.agentName,
            runner: agent.runner,
            agentLoad: agent.currentLoad,
          },
          'Task allocated to agent',
        );
      } else {
        this.results.set(task.id, {
          taskId: task.id,
          status: 'pending',
          error: 'No capable agent available',
        });

        logger.warn({ task: task.id }, 'Task could not be allocated');
      }
    }

    return allocations;
  }

  // ─── Execution Interface ───────────────────────────────────────────────────────

  async executeTask(task: SwarmTask, allocation: SwarmAllocation): Promise<SwarmResult> {
    const result: SwarmResult = {
      taskId: task.id,
      status: 'running',
      agentName: allocation.agentName,
      startedAt: Date.now(),
    };

    this.results.set(task.id, result);

    try {
      // Dynamically import runAgent to avoid circular dependencies
      const { runAgent } = await import('../../tools/run_agent.js');

      const response = await runAgent({
        runner: allocation.runner as 'claude' | 'gemini' | 'kilo' | 'qwencli' | 'openclaw' | 'cline' | 'opencode' | 'hermes',
        prompt: task.prompt,
        agentName: allocation.agentName,
        model: task.model,
        path: task.path,
        autoResume: false,
        silent: false,
      });

      const completedResult: SwarmResult = {
        taskId: task.id,
        status: response.isError ? 'failed' : 'completed',
        agentName: allocation.agentName,
        result: response.content,
        error: response.isError ? response.content?.[0]?.text : undefined,
        startedAt: result.startedAt,
        completedAt: Date.now(),
      };

      this.results.set(task.id, completedResult);

      // Release agent load (guard against underflow)
      const agent = this.agents.get(allocation.agentName);
      if (agent) {
        agent.currentLoad = Math.max(0, agent.currentLoad - 1);
      }

      logger.info(
        {
          task: task.id,
          agent: allocation.agentName,
          status: completedResult.status,
          duration: (completedResult.completedAt || 0) - (completedResult.startedAt || 0),
        },
        'Task execution completed',
      );

      return completedResult;
    } catch (error) {
      const failedResult: SwarmResult = {
        taskId: task.id,
        status: 'failed',
        agentName: allocation.agentName,
        error: error instanceof Error ? error.message : String(error),
        startedAt: result.startedAt,
        completedAt: Date.now(),
      };

      this.results.set(task.id, failedResult);

      // Release agent load (guard against underflow)
      const agent = this.agents.get(allocation.agentName);
      if (agent) {
        agent.currentLoad = Math.max(0, agent.currentLoad - 1);
      }

      logger.error(
        {
          task: task.id,
          agent: allocation.agentName,
          error: failedResult.error,
        },
        'Task execution failed',
      );

      return failedResult;
    }
  }

  // ─── Query Methods ─────────────────────────────────────────────────────────────

  getTaskStatus(taskId: string): SwarmResult | undefined {
    return this.results.get(taskId);
  }

  getAllResults(): SwarmResult[] {
    return Array.from(this.results.values());
  }

  getPendingTasks(): SwarmTask[] {
    return this.taskQueue.filter((t) => !this.allocations.has(t.id));
  }

  getAgentStatus(agentName: string): AgentCapability | undefined {
    return this.agents.get(agentName);
  }

  getAllAgents(): AgentCapability[] {
    return Array.from(this.agents.values());
  }

  getStatistics(): {
    totalTasks: number;
    completed: number;
    failed: number;
    running: number;
    pending: number;
    totalAgents: number;
    averageLoad: number;
  } {
    const results = Array.from(this.results.values());
    const completed = results.filter((r) => r.status === 'completed').length;
    const failed = results.filter((r) => r.status === 'failed').length;
    const running = results.filter((r) => r.status === 'running' || r.status === 'assigned').length;
    const pending = this.getPendingTasks().length;

    const totalLoad = Array.from(this.agents.values()).reduce((sum, a) => sum + Math.max(0, a.currentLoad), 0);
    const averageLoad = this.agents.size > 0 ? totalLoad / this.agents.size : 0;

    return {
      totalTasks: this.taskQueue.length,
      completed,
      failed,
      running,
      pending,
      totalAgents: this.agents.size,
      averageLoad,
    };
  }
}

// ─── Factory ─────────────────────────────────────────────────────────────────────

export function createSwarmOrchestrator(config: SwarmConfig): SwarmOrchestrator {
  return new SwarmOrchestrator(config);
}
