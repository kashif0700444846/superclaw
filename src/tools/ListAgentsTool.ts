// src/tools/ListAgentsTool.ts
import { Tool, ToolResult } from '../gateway/types';
import { taskStore } from '../agents/TaskStore';
import { agentOrchestrator } from '../agents/AgentOrchestrator';
import { TaskStatus } from '../agents/types';

export class ListAgentsTool implements Tool {
  name = 'list_agents';
  description =
    'List all sub-agent tasks. Optionally filter by status. ' +
    'Shows taskId, label, status, model, and timing for each task.';

  parameters = {
    type: 'object',
    properties: {
      status: {
        type: 'string',
        enum: ['pending', 'running', 'completed', 'failed', 'killed', 'all'],
        description: 'Filter by status. Default: "all"',
      },
      limit: {
        type: 'number',
        description: 'Max number of tasks to return (default: 20)',
      },
    },
    required: [],
  };

  async execute(params: { status?: TaskStatus | 'all'; limit?: number }): Promise<ToolResult> {
    const statusFilter = params.status ?? 'all';
    const limit = params.limit ?? 20;

    const tasks = statusFilter === 'all'
      ? taskStore.listAll()
      : taskStore.listByStatus(statusFilter as TaskStatus);

    const sliced = tasks.slice(0, limit);

    return {
      success: true,
      data: {
        total: tasks.length,
        runningCount: agentOrchestrator.getRunningCount(),
        maxConcurrent: parseInt(process.env.MAX_CONCURRENT_AGENTS || '5', 10),
        tasks: sliced.map(t => ({
          taskId: t.id,
          label: t.label,
          status: t.status,
          model: t.model,
          provider: t.provider,
          iteration: t.iteration,
          toolsUsed: t.toolsUsed,
          startedAt: t.startedAt,
          completedAt: t.completedAt,
          error: t.error,
        })),
      },
    };
  }
}

export const listAgentsTool = new ListAgentsTool();
export default listAgentsTool;
