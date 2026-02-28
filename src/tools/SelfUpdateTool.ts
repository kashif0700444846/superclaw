import { Tool, ToolResult } from '../gateway/types';
import { exec } from 'child_process';
import { promisify } from 'util';
import path from 'path';
import fs from 'fs';

const execAsync = promisify(exec);

export class SelfUpdateTool implements Tool {
  name = 'self_update';
  description = 'Check for SuperClaw updates from GitHub and optionally apply them. Use this when the user asks to check for updates or update SuperClaw.';
  parameters = {
    type: 'object',
    properties: {
      action: {
        type: 'string',
        enum: ['check', 'update'],
        description: '"check" to see if an update is available, "update" to actually apply the update and restart'
      }
    },
    required: ['action']
  };

  async execute(args: { action: 'check' | 'update' }): Promise<ToolResult> {
    const installDir = process.cwd();
    
    try {
      if (args.action === 'check') {
        // Get current version
        const pkgPath = path.join(installDir, 'package.json');
        const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
        const currentVersion = pkg.version;

        // Fetch latest version from GitHub
        await execAsync('git fetch origin main 2>&1', { cwd: installDir });
        
        // Check if there are new commits
        const { stdout: logOut } = await execAsync('git log HEAD..origin/main --oneline 2>&1', { cwd: installDir });
        
        if (!logOut.trim()) {
          return { 
            success: true, 
            data: `✅ SuperClaw is up to date! Current version: v${currentVersion}` 
          };
        }

        // Get remote version
        const { stdout: remoteVersion } = await execAsync(
          'git show origin/main:package.json 2>/dev/null | node -e "const d=require(\'fs\').readFileSync(\'/dev/stdin\',\'utf8\'); console.log(JSON.parse(d).version);" 2>/dev/null || echo "unknown"',
          { cwd: installDir }
        ).catch(() => ({ stdout: 'unknown' }));

        const newVersion = remoteVersion.trim();
        const commits = logOut.trim().split('\n').slice(0, 5).join('\n');
        
        return {
          success: true,
          data: `🆕 Update available!\n\nCurrent: v${currentVersion}\nLatest: v${newVersion}\n\nNew commits:\n${commits}\n\nSay "update superclaw" to apply the update.`
        };

      } else if (args.action === 'update') {
        // Get current version before update
        const pkgPath = path.join(installDir, 'package.json');
        const pkgBefore = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
        const versionBefore = pkgBefore.version;

        // Run the update script
        const updateScript = path.join(installDir, 'update.sh');
        
        if (!fs.existsSync(updateScript)) {
          // Fallback: manual update steps
          await execAsync('git checkout -- pnpm-lock.yaml 2>/dev/null || true', { cwd: installDir });
          await execAsync('git pull', { cwd: installDir });
          await execAsync('pnpm install', { cwd: installDir });
          await execAsync('pnpm rebuild better-sqlite3 2>/dev/null || true', { cwd: installDir });
          await execAsync('pnpm build 2>/dev/null || true', { cwd: installDir });
        } else {
          await execAsync(`bash ${updateScript}`, { cwd: installDir, timeout: 120000 });
        }

        // Get new version
        const pkgAfter = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
        const versionAfter = pkgAfter.version;

        // Schedule PM2 restart (after sending the response)
        setTimeout(async () => {
          try {
            await execAsync('pm2 restart superclaw');
          } catch {
            // PM2 might not be available or process name differs
          }
        }, 3000);

        return {
          success: true,
          data: `✅ SuperClaw updated successfully!\n\nv${versionBefore} → v${versionAfter}\n\nRestarting in 3 seconds... I'll be back shortly! 🔄`
        };
      }

      return { success: false, error: 'Invalid action. Use "check" or "update".' };
    } catch (err: any) {
      return { success: false, error: `Update failed: ${err.message}` };
    }
  }
}
