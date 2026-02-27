import fs from 'fs';
import path from 'path';
import { Tool, ToolResult } from '../gateway/types';
import { logger } from '../logger';

const PROTECTED_PATHS = [
  '.env',
  'superclaw/src',
  'superclaw/.env',
];

export class FileReadTool implements Tool {
  name = 'file_read';
  description = 'Reads the content of any file on the system. Returns text content or base64 for binary files.';
  parameters = {
    type: 'object',
    properties: {
      path: {
        type: 'string',
        description: 'Absolute or relative path to the file to read',
      },
      encoding: {
        type: 'string',
        description: 'File encoding: "utf-8" (default) or "base64" for binary files',
        enum: ['utf-8', 'base64'],
      },
    },
    required: ['path'],
  };

  private isProtected(filePath: string): boolean {
    const resolved = path.resolve(filePath);
    return PROTECTED_PATHS.some((p) => resolved.includes(p));
  }

  async execute(params: { path: string; encoding?: 'utf-8' | 'base64' }): Promise<ToolResult> {
    const { path: filePath, encoding = 'utf-8' } = params;

    if (this.isProtected(filePath)) {
      return {
        success: false,
        error: `Access denied: ${filePath} is a protected path.`,
      };
    }

    try {
      const resolved = path.resolve(filePath);

      if (!fs.existsSync(resolved)) {
        return { success: false, error: `File not found: ${resolved}` };
      }

      const stats = fs.statSync(resolved);
      if (stats.isDirectory()) {
        return { success: false, error: `Path is a directory, not a file: ${resolved}` };
      }

      const content = fs.readFileSync(resolved, encoding);
      logger.debug(`FileReadTool read: ${resolved} (${stats.size} bytes)`);

      return {
        success: true,
        data: {
          path: resolved,
          content,
          size: stats.size,
          encoding,
          modified: stats.mtime.toISOString(),
        },
      };
    } catch (error: any) {
      logger.error(`FileReadTool error reading ${filePath}`, { error });
      return { success: false, error: error.message };
    }
  }
}

export const fileReadTool = new FileReadTool();
export default fileReadTool;
