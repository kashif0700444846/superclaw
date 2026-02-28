// src/tools/SpawnAgentTool.ts
import { Tool, ToolResult } from '../gateway/types';
import { agentOrchestrator } from '../agents/AgentOrchestrator';
import { taskStore } from '../agents/TaskStore';
import { AIProvider } from '../agents/types';
import { logger } from '../logger';

export class SpawnAgentTool implements Tool {
  name = 'spawn_agent';
  description =
    'Spawns a new sub-agent process to work on a task in parallel. ' +
    'Returns immediately with a taskId. Use check_agent to poll status. ' +
    'Sub-agents can use all tools (shell, file, HTTP, etc.) and run their own AI loop. ' +
    'You can assign a different AI model/provider to each sub-agent.';

  parameters = {
    type: 'object',
    properties: {
      label: {
        type: 'string',
        description: 'Short human-readable label for this task (e.g. "Build HTML for sub.pmdice.com")',
      },
      prompt: {
        type: 'string',
        description: 'Full task description for the sub-agent. Be specific and detailed.',
      },
      model: {
        type: 'string',
        description: 'AI model to use (e.g. "gpt-4o-mini", "claude-3-haiku-20240307"). Defaults to master model.',
      },
      provider: {
        type: 'string',
        enum: ['openai', 'anthropic', 'groq', 'ollama', 'custom'],
        description: 'AI provider for this sub-agent. Defaults to master provider.',
      },
      timeoutMs: {
        type: 'number',
        description: 'Timeout in milliseconds (default: 300000 = 5 minutes)',
      },
    },
    required: ['label', 'prompt'],
  };

  async execute(params: {
    label: string;
    prompt: string;
    model?: string;
    provider?: AIProvider;
    timeoutMs?: number;
  }): Promise<ToolResult> {
    try {
      const task = await agentOrchestrator.spawn({
        label: params.label,
        prompt: params.prompt,
        model: params.model,
        provider: params.provider,
        timeoutMs: params.timeoutMs,
      });

      logger.info(`SpawnAgentTool: spawned task ${task.id} (${task.label})`);

      // Verify the task was actually created in TaskStore
      const stored = taskStore.read(task.id);
      if (!stored) {
        return {
          success: false,
          error: `Sub-agent process was forked but task record not found in TaskStore for id "${task.id}". Spawning may have failed.`,
        };
      }

      return {
        success: true,
        data: {
          taskId: task.id,
          label: task.label,
          model: task.model,
          provider: task.provider,
          status: stored.status,
          message: `Sub-agent spawned successfully. Use check_agent with taskId "${task.id}" to monitor progress.`,
        },
      };
    } catch (err: any) {
      logger.error(`SpawnAgentTool: failed to spawn agent`, { error: err.message });
      return { success: false, error: `Failed to spawn sub-agent: ${err.message}` };
    }
  }
}

export const spawnAgentTool = new SpawnAgentTool();
export default spawnAgentTool;
