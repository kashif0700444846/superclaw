import { Tool, ToolResult } from '../gateway/types';
import { memoryManager } from '../memory/MemoryManager';
import { logger } from '../logger';

export class MemoryReadTool implements Tool {
  name = 'memory_read';
  description = 'Reads agent memory files: MEMORY.md (long-term facts), SOUL.md (identity/rules), or a specific daily log.';
  parameters = {
    type: 'object',
    properties: {
      target: {
        type: 'string',
        enum: ['memory', 'soul', 'log', 'log_list'],
        description: 'Which memory file to read',
      },
      date: {
        type: 'string',
        description: 'Date in YYYY-MM-DD format (required when target=log)',
      },
    },
    required: ['target'],
  };

  async execute(params: { target: string; date?: string }): Promise<ToolResult> {
    const { target, date } = params;

    try {
      switch (target) {
        case 'memory': {
          const content = memoryManager.readMemory();
          return { success: true, data: { content, source: 'MEMORY.md' } };
        }
        case 'soul': {
          const content = memoryManager.readSoul();
          return { success: true, data: { content, source: 'SOUL.md' } };
        }
        case 'log': {
          if (!date) {
            const content = memoryManager.readTodayLog();
            return { success: true, data: { content, source: 'today' } };
          }
          const content = memoryManager.readLog(date);
          return { success: true, data: { content, source: date } };
        }
        case 'log_list': {
          const dates = memoryManager.listLogDates();
          return { success: true, data: { dates } };
        }
        default:
          return { success: false, error: `Unknown target: ${target}` };
      }
    } catch (error: any) {
      logger.error(`MemoryReadTool error`, { error });
      return { success: false, error: error.message };
    }
  }
}

export const memoryReadTool = new MemoryReadTool();
export default memoryReadTool;
