// src/tools/CheckAgentTool.ts
import { Tool, ToolResult } from '../gateway/types';
import { taskStore } from '../agents/TaskStore';

export class CheckAgentTool implements Tool {
  name = 'check_agent';
  description =
    'Check the status and result of a sub-agent task. ' +
    'Returns current status (pending/running/completed/failed/killed), ' +
    'progress info, and the final result if completed.';

  parameters = {
    type: 'object',
    properties: {
      taskId: {
        type: 'string',
        description: 'The task ID returned by spawn_agent',
      },
    },
    required: ['taskId'],
  };

  async execute(params: { taskId: string }): Promise<ToolResult> {
    const task = taskStore.read(params.taskId);

    if (!task) {
      return { success: false, error: `Task not found: ${params.taskId}` };
    }

    return {
      success: true,
      data: {
        taskId: task.id,
        label: task.label,
        status: task.status,
        model: task.model,
        provider: task.provider,
        iteration: task.iteration,
        toolsUsed: task.toolsUsed,
        result: task.result,
        error: task.error,
        startedAt: task.startedAt,
        completedAt: task.completedAt,
        durationMs: task.startedAt && task.completedAt
          ? new Date(task.completedAt).getTime() - new Date(task.startedAt).getTime()
          : null,
      },
    };
  }
}

export const checkAgentTool = new CheckAgentTool();
export default checkAgentTool;
