import { Tool, ToolResult } from '../gateway/types';
import { memoryManager } from '../memory/MemoryManager';
import { logger } from '../logger';

export class MemoryWriteTool implements Tool {
  name = 'memory_write';
  description = 'Writes to agent memory: append a fact to MEMORY.md, update SOUL.md, or write a daily log entry.';
  parameters = {
    type: 'object',
    properties: {
      target: {
        type: 'string',
        enum: ['memory_append', 'memory_overwrite', 'soul', 'log'],
        description: 'Which memory to write to',
      },
      content: {
        type: 'string',
        description: 'Content to write',
      },
      platform: {
        type: 'string',
        description: 'Platform name (for log entries)',
      },
      outcome: {
        type: 'string',
        description: 'Outcome summary (for log entries)',
      },
    },
    required: ['target', 'content'],
  };

  async execute(params: {
    target: string;
    content: string;
    platform?: string;
    outcome?: string;
  }): Promise<ToolResult> {
    const { target, content, platform = 'unknown', outcome = 'completed' } = params;

    try {
      switch (target) {
        case 'memory_append':
          memoryManager.appendMemory(content);
          return { success: true, data: { message: 'Fact appended to MEMORY.md' } };

        case 'memory_overwrite':
          memoryManager.overwriteMemory(content);
          return { success: true, data: { message: 'MEMORY.md overwritten' } };

        case 'soul':
          memoryManager.writeSoul(content);
          return { success: true, data: { message: 'SOUL.md updated' } };

        case 'log':
          memoryManager.appendTodayLog(platform, content, outcome);
          return { success: true, data: { message: 'Log entry written' } };

        default:
          return { success: false, error: `Unknown target: ${target}` };
      }
    } catch (error: any) {
      logger.error(`MemoryWriteTool error`, { error });
      return { success: false, error: error.message };
    }
  }
}

export const memoryWriteTool = new MemoryWriteTool();
export default memoryWriteTool;
