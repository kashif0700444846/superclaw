import fs from 'fs';
import path from 'path';
import { Tool, ToolResult } from '../gateway/types';
import { logger } from '../logger';

const PROTECTED_DIRS = ['superclaw/src', 'superclaw/.env'];

export class FileListTool implements Tool {
  name = 'file_list';
  description = 'Lists directory contents with metadata including size, permissions, and modification date.';
  parameters = {
    type: 'object',
    properties: {
      path: {
        type: 'string',
        description: 'Directory path to list',
      },
      recursive: {
        type: 'boolean',
        description: 'If true, list recursively (default: false)',
      },
    },
    required: ['path'],
  };

  private isProtected(dirPath: string): boolean {
    const resolved = path.resolve(dirPath);
    return PROTECTED_DIRS.some((p) => resolved.includes(p));
  }

  private listDir(dirPath: string, recursive: boolean): any[] {
    const entries = fs.readdirSync(dirPath, { withFileTypes: true });
    const results: any[] = [];

    for (const entry of entries) {
      const fullPath = path.join(dirPath, entry.name);
      try {
        const stats = fs.statSync(fullPath);
        const item: any = {
          name: entry.name,
          path: fullPath,
          type: entry.isDirectory() ? 'directory' : 'file',
          size: stats.size,
          permissions: stats.mode.toString(8),
          modified: stats.mtime.toISOString(),
          created: stats.birthtime.toISOString(),
        };

        if (recursive && entry.isDirectory()) {
          item.children = this.listDir(fullPath, true);
        }

        results.push(item);
      } catch {
        // Skip files we can't stat
      }
    }

    return results;
  }

  async execute(params: { path: string; recursive?: boolean }): Promise<ToolResult> {
    const { path: dirPath, recursive = false } = params;

    if (this.isProtected(dirPath)) {
      return { success: false, error: `Access denied: ${dirPath} is a protected path.` };
    }

    try {
      const resolved = path.resolve(dirPath);

      if (!fs.existsSync(resolved)) {
        return { success: false, error: `Directory not found: ${resolved}` };
      }

      const stats = fs.statSync(resolved);
      if (!stats.isDirectory()) {
        return { success: false, error: `Path is not a directory: ${resolved}` };
      }

      const entries = this.listDir(resolved, recursive);
      logger.debug(`FileListTool listed: ${resolved} (${entries.length} entries)`);

      return {
        success: true,
        data: {
          path: resolved,
          entries,
          count: entries.length,
        },
      };
    } catch (error: any) {
      logger.error(`FileListTool error listing ${dirPath}`, { error });
      return { success: false, error: error.message };
    }
  }
}

export const fileListTool = new FileListTool();
export default fileListTool;
