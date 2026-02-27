import { exec } from 'child_process';
import { promisify } from 'util';
import { Tool, ToolResult } from '../gateway/types';
import { logger } from '../logger';

const execAsync = promisify(exec);

export class ProcessManagerTool implements Tool {
  name = 'process_manager';
  description = 'Lists running processes, kills processes by PID or name, and gets process information.';
  parameters = {
    type: 'object',
    properties: {
      action: {
        type: 'string',
        enum: ['list', 'kill', 'info'],
        description: 'Action to perform',
      },
      pid: {
        type: 'number',
        description: 'Process ID (for kill/info actions)',
      },
      name: {
        type: 'string',
        description: 'Process name pattern (for kill/info actions)',
      },
      signal: {
        type: 'string',
        description: 'Kill signal (default: SIGTERM). Use SIGKILL for force kill.',
        enum: ['SIGTERM', 'SIGKILL', 'SIGHUP', 'SIGINT'],
      },
    },
    required: ['action'],
  };

  async execute(params: {
    action: string;
    pid?: number;
    name?: string;
    signal?: string;
  }): Promise<ToolResult> {
    const { action, pid, name, signal = 'SIGTERM' } = params;

    try {
      if (action === 'list') {
        const { stdout } = await execAsync('ps aux --no-headers | head -50');
        const processes = stdout.trim().split('\n').map((line) => {
          const parts = line.trim().split(/\s+/);
          return {
            user: parts[0],
            pid: parseInt(parts[1]),
            cpu: parseFloat(parts[2]),
            mem: parseFloat(parts[3]),
            command: parts.slice(10).join(' '),
          };
        });
        return { success: true, data: { processes } };
      }

      if (action === 'kill') {
        if (!pid && !name) {
          return { success: false, error: 'pid or name required for kill action' };
        }
        let command: string;
        if (pid) {
          command = `kill -${signal} ${pid}`;
        } else {
          command = `pkill -${signal} -f "${name}"`;
        }
        await execAsync(command);
        logger.info(`ProcessManagerTool killed: ${pid || name} with ${signal}`);
        return { success: true, data: { message: `Process ${pid || name} killed with ${signal}` } };
      }

      if (action === 'info') {
        if (!pid && !name) {
          return { success: false, error: 'pid or name required for info action' };
        }
        let command: string;
        if (pid) {
          command = `ps -p ${pid} -o pid,ppid,user,%cpu,%mem,vsz,rss,stat,start,time,command --no-headers`;
        } else {
          command = `pgrep -a -f "${name}"`;
        }
        const { stdout } = await execAsync(command);
        return { success: true, data: { info: stdout.trim() } };
      }

      return { success: false, error: `Unknown action: ${action}` };
    } catch (error: any) {
      logger.error(`ProcessManagerTool error`, { error });
      return { success: false, error: error.message };
    }
  }
}

export const processManagerTool = new ProcessManagerTool();
export default processManagerTool;
