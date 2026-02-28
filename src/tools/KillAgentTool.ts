// src/tools/KillAgentTool.ts
import { Tool, ToolResult } from '../gateway/types';
import { agentOrchestrator } from '../agents/AgentOrchestrator';
import { taskStore } from '../agents/TaskStore';

export class KillAgentTool implements Tool {
  name = 'kill_agent';
  description =
    'Kill a running sub-agent process. ' +
    'The task will be marked as "killed". ' +
    'Use this if a sub-agent is stuck, taking too long, or produced wrong results.';

  parameters = {
    type: 'object',
    properties: {
      taskId: {
        type: 'string',
        description: 'The task ID of the sub-agent to kill',
      },
      reason: {
        type: 'string',
        description: 'Reason for killing (for logging)',
      },
    },
    required: ['taskId'],
  };

  async execute(params: { taskId: string; reason?: string }): Promise<ToolResult> {
    const task = taskStore.read(params.taskId);

    if (!task) {
      return { success: false, error: `Task not found: ${params.taskId}` };
    }

    if (task.status !== 'running') {
      return {
        success: false,
        error: `Task ${params.taskId} is not running (status: ${task.status})`,
      };
    }

    const killed = agentOrchestrator.killAgent(params.taskId, params.reason ?? 'Killed by master');

    if (!killed) {
      return {
        success: false,
        error: `Could not kill task ${params.taskId} — process handle not found (may have already exited)`,
      };
    }

    return {
      success: true,
      data: {
        taskId: params.taskId,
        label: task.label,
        message: `Sub-agent killed successfully`,
      },
    };
  }
}

export const killAgentTool = new KillAgentTool();
export default killAgentTool;
