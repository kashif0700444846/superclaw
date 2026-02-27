import { exec } from 'child_process';
import { promisify } from 'util';
import { Tool, ToolResult } from '../gateway/types';
import { logger } from '../logger';

const execAsync = promisify(exec);

export class CronManagerTool implements Tool {
  name = 'cron_manager';
  description = 'Manages cron jobs. Can list all crontabs, add a new cron job, or remove an existing one.';
  parameters = {
    type: 'object',
    properties: {
      action: {
        type: 'string',
        enum: ['list', 'add', 'remove'],
        description: 'Action to perform',
      },
      schedule: {
        type: 'string',
        description: 'Cron schedule expression (e.g., "0 * * * *") — required for add',
      },
      command: {
        type: 'string',
        description: 'Command to run — required for add',
      },
      pattern: {
        type: 'string',
        description: 'Pattern to match for removal — required for remove',
      },
    },
    required: ['action'],
  };

  async execute(params: {
    action: string;
    schedule?: string;
    command?: string;
    pattern?: string;
  }): Promise<ToolResult> {
    const { action, schedule, command, pattern } = params;

    try {
      if (action === 'list') {
        const { stdout } = await execAsync('crontab -l 2>/dev/null || echo "No crontab"');
        return { success: true, data: { crontab: stdout.trim() } };
      }

      if (action === 'add') {
        if (!schedule || !command) {
          return { success: false, error: 'schedule and command are required for add action' };
        }
        const newEntry = `${schedule} ${command}`;
        const { stdout: existing } = await execAsync('crontab -l 2>/dev/null || echo ""');
        const updated = existing.trim() + '\n' + newEntry + '\n';
        await execAsync(`echo "${updated.replace(/"/g, '\\"')}" | crontab -`);
        logger.info(`CronManagerTool added: ${newEntry}`);
        return { success: true, data: { message: `Cron job added: ${newEntry}` } };
      }

      if (action === 'remove') {
        if (!pattern) {
          return { success: false, error: 'pattern is required for remove action' };
        }
        const { stdout: existing } = await execAsync('crontab -l 2>/dev/null || echo ""');
        const lines = existing.split('\n').filter((line) => !line.includes(pattern));
        const updated = lines.join('\n');
        await execAsync(`echo "${updated.replace(/"/g, '\\"')}" | crontab -`);
        logger.info(`CronManagerTool removed entries matching: ${pattern}`);
        return { success: true, data: { message: `Removed cron entries matching: ${pattern}` } };
      }

      return { success: false, error: `Unknown action: ${action}` };
    } catch (error: any) {
      logger.error(`CronManagerTool error`, { error });
      return { success: false, error: error.message };
    }
  }
}

export const cronManagerTool = new CronManagerTool();
export default cronManagerTool;
