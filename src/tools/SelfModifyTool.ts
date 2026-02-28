import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import { Tool, ToolResult } from '../gateway/types';

const ROOT = path.resolve(process.cwd());
const SRC_DIR = path.join(ROOT, 'src');

// Safety: only allow editing files inside src/
function isSafeSourcePath(filePath: string): boolean {
  const resolved = path.resolve(ROOT, filePath);
  return resolved.startsWith(SRC_DIR) && resolved.endsWith('.ts');
}

export class SelfModifyTool implements Tool {
  name = 'self_modify';
  description = `Modify SuperClaw's own TypeScript source files, then rebuild and restart.
Use this when the user asks you to add a feature, fix a bug, or change your own behavior.
Actions:
- "read_file": Read a source file to understand current code before modifying
- "write_file": Write new content to a source file (replaces entire file)
- "list_files": List all .ts files in src/ directory tree
- "rebuild": Run pnpm build to compile TypeScript (check for errors before restarting)
- "restart": Restart the PM2 process to apply changes (only after successful rebuild)
- "rebuild_and_restart": Rebuild then restart in one step

IMPORTANT SAFETY RULES:
1. Always read a file before modifying it
2. Always rebuild after writing files to check for TypeScript errors
3. Only restart after a successful rebuild (no TypeScript errors)
4. Only modify files inside the src/ directory
5. Never modify node_modules, dist, or system files`;

  parameters = {
    type: 'object' as const,
    properties: {
      action: {
        type: 'string',
        enum: ['read_file', 'write_file', 'list_files', 'rebuild', 'restart', 'rebuild_and_restart'],
        description: 'Action to perform'
      },
      file_path: {
        type: 'string',
        description: 'Relative path to source file (e.g., "src/tools/MyTool.ts"). Required for read_file and write_file.'
      },
      content: {
        type: 'string',
        description: 'New file content (full file). Required for write_file.'
      }
    },
    required: ['action']
  };

  async execute(args: { action: string; file_path?: string; content?: string }): Promise<ToolResult> {
    try {
      switch (args.action) {

        case 'list_files': {
          const files = this.listTsFiles(SRC_DIR, ROOT);
          return { success: true, data: `TypeScript source files in src/:\n${files.join('\n')}` };
        }

        case 'read_file': {
          if (!args.file_path) return { success: false, error: 'file_path is required for read_file' };
          if (!isSafeSourcePath(args.file_path)) {
            return { success: false, error: `❌ Safety check failed: can only read .ts files inside src/` };
          }
          const fullPath = path.resolve(ROOT, args.file_path);
          if (!fs.existsSync(fullPath)) {
            return { success: false, error: `File not found: ${args.file_path}` };
          }
          const content = fs.readFileSync(fullPath, 'utf-8');
          return { success: true, data: `=== ${args.file_path} ===\n${content}` };
        }

        case 'write_file': {
          if (!args.file_path) return { success: false, error: 'file_path is required for write_file' };
          if (!args.content) return { success: false, error: 'content is required for write_file' };
          if (!isSafeSourcePath(args.file_path)) {
            return { success: false, error: `❌ Safety check failed: can only write .ts files inside src/` };
          }
          const fullPath = path.resolve(ROOT, args.file_path);
          // Create directory if needed
          fs.mkdirSync(path.dirname(fullPath), { recursive: true });
          // Backup original if it exists
          if (fs.existsSync(fullPath)) {
            fs.writeFileSync(fullPath + '.bak', fs.readFileSync(fullPath));
          }
          fs.writeFileSync(fullPath, args.content, 'utf-8');
          return { success: true, data: `✅ Written ${args.file_path} (${args.content.length} bytes). Run rebuild to check for TypeScript errors.` };
        }

        case 'rebuild': {
          try {
            const output = execSync('pnpm build 2>&1', { cwd: ROOT, timeout: 60000 }).toString();
            return { success: true, data: `✅ Build successful!\n${output}` };
          } catch (err: any) {
            const msg = err?.stdout?.toString() || (err instanceof Error ? err.message : String(err));
            return { success: false, error: `❌ Build failed — TypeScript errors:\n${msg}\n\nFix the errors and try rebuild again. Do NOT restart until build succeeds.` };
          }
        }

        case 'restart': {
          try {
            execSync('pm2 restart superclaw 2>&1', { cwd: ROOT, timeout: 15000 });
            return { success: true, data: `✅ SuperClaw restarted via PM2. Changes are now live!` };
          } catch (err: unknown) {
            const msg = err instanceof Error ? err.message : String(err);
            return { success: false, error: `❌ PM2 restart failed: ${msg}` };
          }
        }

        case 'rebuild_and_restart': {
          // Rebuild first
          let buildOutput = '';
          try {
            buildOutput = execSync('pnpm build 2>&1', { cwd: ROOT, timeout: 60000 }).toString();
          } catch (err: any) {
            const msg = err?.stdout?.toString() || (err instanceof Error ? err.message : String(err));
            return { success: false, error: `❌ Build failed — NOT restarting:\n${msg}` };
          }
          // Then restart
          try {
            execSync('pm2 restart superclaw 2>&1', { cwd: ROOT, timeout: 15000 });
            return { success: true, data: `✅ Build successful and SuperClaw restarted! Changes are live.\n\nBuild output:\n${buildOutput}` };
          } catch (err: unknown) {
            const msg = err instanceof Error ? err.message : String(err);
            return { success: false, error: `✅ Build succeeded but PM2 restart failed: ${msg}` };
          }
        }

        default:
          return { success: false, error: `Unknown action: ${args.action}` };
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return { success: false, error: `SelfModifyTool error: ${msg}` };
    }
  }

  private listTsFiles(dir: string, root: string): string[] {
    const results: string[] = [];
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory() && !entry.name.startsWith('.')) {
        results.push(...this.listTsFiles(fullPath, root));
      } else if (entry.isFile() && entry.name.endsWith('.ts')) {
        results.push(path.relative(root, fullPath).replace(/\\/g, '/'));
      }
    }
    return results;
  }
}
