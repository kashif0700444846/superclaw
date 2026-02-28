import { Tool, ToolResult } from '../gateway/types';
import { exec } from 'child_process';
import { promisify } from 'util';
import https from 'https';
import path from 'path';
import fs from 'fs';

const execAsync = promisify(exec);

interface GitHubCommit {
  sha: string;
  commit: {
    message: string;
    author: {
      name: string;
      date: string;
    };
  };
}

function httpsGet(url: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { headers: { 'User-Agent': 'SuperClaw-Agent' } }, (res) => {
      let data = '';
      res.on('data', (chunk: Buffer) => { data += chunk.toString(); });
      res.on('end', () => resolve(data));
    });
    req.on('error', reject);
    req.setTimeout(10000, () => { req.destroy(); reject(new Error('Request timed out')); });
  });
}

export class SelfUpdateTool implements Tool {
  name = 'self_update';
  description = 'Check for SuperClaw updates from GitHub, view recent changelog, or apply an update. Use this when the user asks to check for updates, update SuperClaw, ask "what changed recently", or "show changelog".';
  parameters = {
    type: 'object',
    properties: {
      action: {
        type: 'string',
        enum: ['check', 'update', 'changelog'],
        description: '"check" to see if an update is available (shows current vs latest version), "update" to apply the update and restart, "changelog" to fetch the last 5 commit messages from GitHub'
      }
    },
    required: ['action']
  };

  async execute(args: { action: 'check' | 'update' | 'changelog' }): Promise<ToolResult> {
    const installDir = process.cwd();

    try {
      if (args.action === 'check') {
        // Read current version from package.json at runtime
        const pkgPath = path.join(installDir, 'package.json');
        const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8')) as { version: string };
        const currentVersion = pkg.version;

        // Fetch latest commits from remote
        await execAsync('git fetch origin main 2>&1', { cwd: installDir });

        // Check if there are new commits
        const { stdout: logOut } = await execAsync('git log HEAD..origin/main --oneline 2>&1', { cwd: installDir });

        if (!logOut.trim()) {
          return {
            success: true,
            data: `✅ SuperClaw is up to date! (v${currentVersion})`
          };
        }

        // Get remote version from origin/main:package.json via git show
        let newVersion = 'unknown';
        try {
          const { stdout: remoteJson } = await execAsync('git show origin/main:package.json', { cwd: installDir });
          const remotePkg = JSON.parse(remoteJson) as { version: string };
          newVersion = remotePkg.version;
        } catch {
          // fallback: leave as 'unknown'
        }

        const commits = logOut.trim().split('\n').slice(0, 5).join('\n');

        return {
          success: true,
          data: `🆕 Update available: v${currentVersion} → v${newVersion}\n\nNew commits:\n${commits}\n\nSay "update superclaw" to apply the update, or "show changelog" to see details.`
        };

      } else if (args.action === 'changelog') {
        // Fetch last 5 commits from GitHub API
        const apiUrl = 'https://api.github.com/repos/kashif0700444846/superclaw/commits?per_page=5';

        let commits: GitHubCommit[];
        try {
          const raw = await httpsGet(apiUrl);
          commits = JSON.parse(raw) as GitHubCommit[];
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : String(err);
          return {
            success: false,
            error: `⚠️ Could not fetch changelog from GitHub: ${msg}`
          };
        }

        if (!Array.isArray(commits) || commits.length === 0) {
          return {
            success: false,
            error: '⚠️ No commits found or GitHub API returned an unexpected response.'
          };
        }

        const lines = commits.map((c, i) => {
          const shortSha = c.sha.slice(0, 7);
          const date = c.commit.author.date.slice(0, 10);
          // Use only the first line of the commit message
          const message = c.commit.message.split('\n')[0];
          return `${i + 1}. \`${shortSha}\` (${date}) — ${message}`;
        });

        return {
          success: true,
          data: `📋 Recent SuperClaw changes (last 5 commits):\n\n${lines.join('\n')}`
        };

      } else if (args.action === 'update') {
        // Read current version before update
        const pkgPath = path.join(installDir, 'package.json');
        const pkgBefore = JSON.parse(fs.readFileSync(pkgPath, 'utf-8')) as { version: string };
        const versionBefore = pkgBefore.version;

        // Run the update script or fallback steps
        const updateScript = path.join(installDir, 'update.sh');

        if (!fs.existsSync(updateScript)) {
          await execAsync('git checkout -- pnpm-lock.yaml 2>/dev/null || true', { cwd: installDir });
          await execAsync('git pull', { cwd: installDir });
          await execAsync('pnpm install', { cwd: installDir });
          await execAsync('pnpm rebuild better-sqlite3 2>/dev/null || true', { cwd: installDir });
          await execAsync('pnpm build 2>/dev/null || true', { cwd: installDir });
        } else {
          await execAsync(`bash ${updateScript}`, { cwd: installDir, timeout: 120000 });
        }

        // Read new version after update
        const pkgAfter = JSON.parse(fs.readFileSync(pkgPath, 'utf-8')) as { version: string };
        const versionAfter = pkgAfter.version;

        // Schedule PM2 restart after sending the response
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

      return { success: false, error: 'Invalid action. Use "check", "update", or "changelog".' };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return { success: false, error: `Update failed: ${msg}` };
    }
  }
}
