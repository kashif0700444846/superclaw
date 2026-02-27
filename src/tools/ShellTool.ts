import { exec } from 'child_process';
import { promisify } from 'util';
import { Tool, ToolResult } from '../gateway/types';
import { logger } from '../logger';
import { gateway } from '../gateway/Gateway';

const execAsync = promisify(exec);

const DESTRUCTIVE_PATTERNS = [
  'rm -rf',
  'mkfs',
  'dd if=',
  '> /dev/sd',
  'shutdown',
  'reboot',
  'halt',
  'format',
  'DROP TABLE',
  'DROP DATABASE',
  'truncate',
];

export class ShellTool implements Tool {
  name = 'shell_execute';
  description = 'Executes a shell command on the VPS. Returns stdout, stderr, exit code, and duration. Destructive commands require confirmation.';
  parameters = {
    type: 'object',
    properties: {
      command: {
        type: 'string',
        description: 'The shell command to execute',
      },
      timeout: {
        type: 'number',
        description: 'Timeout in milliseconds (default: 30000)',
      },
      platform: {
        type: 'string',
        description: 'Platform context for confirmation requests (telegram|whatsapp)',
      },
      chatId: {
        type: 'string',
        description: 'Chat ID for confirmation requests',
      },
      userId: {
        type: 'string',
        description: 'User ID for confirmation requests',
      },
    },
    required: ['command'],
  };

  private isDestructive(command: string): boolean {
    return DESTRUCTIVE_PATTERNS.some((pattern) =>
      command.toLowerCase().includes(pattern.toLowerCase())
    );
  }

  async execute(params: {
    command: string;
    timeout?: number;
    platform?: string;
    chatId?: string;
    userId?: string;
  }): Promise<ToolResult> {
    const { command, timeout = 30000, platform, chatId, userId } = params;

    logger.info(`ShellTool executing: ${command}`);

    if (this.isDestructive(command)) {
      if (platform && chatId && userId) {
        const confirmed = await gateway.requestConfirmation(
          platform as any,
          chatId,
          userId,
          command
        );
        if (!confirmed) {
          return {
            success: false,
            error: 'Destructive operation cancelled by user.',
          };
        }
      } else {
        return {
          success: false,
          error: `Destructive command detected: "${command}". Cannot execute without confirmation context.`,
        };
      }
    }

    const startTime = Date.now();
    try {
      const { stdout, stderr } = await execAsync(command, {
        timeout,
        maxBuffer: 1024 * 1024 * 10, // 10MB
      });
      const duration = Date.now() - startTime;

      return {
        success: true,
        data: {
          stdout: stdout.trim(),
          stderr: stderr.trim(),
          exitCode: 0,
          duration,
        },
      };
    } catch (error: any) {
      const duration = Date.now() - startTime;
      return {
        success: false,
        data: {
          stdout: error.stdout?.trim() || '',
          stderr: error.stderr?.trim() || error.message,
          exitCode: error.code || 1,
          duration,
        },
        error: error.message,
      };
    }
  }
}

export const shellTool = new ShellTool();
export default shellTool;
