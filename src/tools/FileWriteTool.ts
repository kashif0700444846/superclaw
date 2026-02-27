import fs from 'fs';
import path from 'path';
import { Tool, ToolResult } from '../gateway/types';
import { logger } from '../logger';

const PROTECTED_PATHS = ['.env', 'superclaw/src'];

export class FileWriteTool implements Tool {
  name = 'file_write';
  description = 'Writes content to a file. Creates parent directories if needed. Can append or overwrite.';
  parameters = {
    type: 'object',
    properties: {
      path: {
        type: 'string',
        description: 'Absolute or relative path to the file to write',
      },
      content: {
        type: 'string',
        description: 'Content to write to the file',
      },
      append: {
        type: 'boolean',
        description: 'If true, append to existing file. If false (default), overwrite.',
      },
    },
    required: ['path', 'content'],
  };

  private isProtected(filePath: string): boolean {
    const resolved = path.resolve(filePath);
    return PROTECTED_PATHS.some((p) => resolved.includes(p));
  }

  async execute(params: { path: string; content: string; append?: boolean }): Promise<ToolResult> {
    const { path: filePath, content, append = false } = params;

    if (this.isProtected(filePath)) {
      return { success: false, error: `Access denied: ${filePath} is a protected path.` };
    }

    try {
      const resolved = path.resolve(filePath);
      const dir = path.dirname(resolved);

      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }

      if (append) {
        fs.appendFileSync(resolved, content);
      } else {
        fs.writeFileSync(resolved, content);
      }

      const stats = fs.statSync(resolved);
      logger.debug(`FileWriteTool wrote: ${resolved} (${stats.size} bytes, append=${append})`);

      return {
        success: true,
        data: {
          path: resolved,
          size: stats.size,
          append,
          message: `File ${append ? 'appended' : 'written'} successfully.`,
        },
      };
    } catch (error: any) {
      logger.error(`FileWriteTool error writing ${filePath}`, { error });
      return { success: false, error: error.message };
    }
  }
}

export const fileWriteTool = new FileWriteTool();
export default fileWriteTool;
