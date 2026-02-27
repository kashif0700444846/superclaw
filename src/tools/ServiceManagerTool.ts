import { exec } from 'child_process';
import { promisify } from 'util';
import { Tool, ToolResult } from '../gateway/types';
import { logger } from '../logger';

const execAsync = promisify(exec);

export class ServiceManagerTool implements Tool {
  name = 'service_manager';
  description = 'Manages systemd services. Can start, stop, restart, check status, enable, disable, or list all services.';
  parameters = {
    type: 'object',
    properties: {
      action: {
        type: 'string',
        enum: ['start', 'stop', 'restart', 'status', 'enable', 'disable', 'list'],
        description: 'Action to perform',
      },
      service: {
        type: 'string',
        description: 'Service name (not required for list action)',
      },
    },
    required: ['action'],
  };

  async execute(params: { action: string; service?: string }): Promise<ToolResult> {
    const { action, service } = params;

    try {
      let command: string;

      if (action === 'list') {
        command = 'systemctl list-units --type=service --no-pager --plain';
      } else {
        if (!service) {
          return { success: false, error: `Service name required for action: ${action}` };
        }
        command = `sudo systemctl ${action} ${service}`;
      }

      logger.info(`ServiceManagerTool: ${command}`);
      const { stdout, stderr } = await execAsync(command, { timeout: 30000 });

      return {
        success: true,
        data: {
          command,
          output: stdout.trim() || stderr.trim(),
        },
      };
    } catch (error: any) {
      logger.error(`ServiceManagerTool error`, { error });
      return {
        success: false,
        data: {
          stdout: error.stdout?.trim() || '',
          stderr: error.stderr?.trim() || error.message,
        },
        error: error.message,
      };
    }
  }
}

export const serviceManagerTool = new ServiceManagerTool();
export default serviceManagerTool;
