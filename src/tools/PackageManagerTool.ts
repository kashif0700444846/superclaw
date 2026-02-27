import { exec } from 'child_process';
import { promisify } from 'util';
import { Tool, ToolResult } from '../gateway/types';
import { logger } from '../logger';

const execAsync = promisify(exec);

export class PackageManagerTool implements Tool {
  name = 'package_manager';
  description = 'Installs or removes packages using apt-get, npm, pnpm, or pip. Uses sudo automatically for system packages.';
  parameters = {
    type: 'object',
    properties: {
      manager: {
        type: 'string',
        enum: ['apt', 'npm', 'pnpm', 'pip', 'pip3'],
        description: 'Package manager to use',
      },
      action: {
        type: 'string',
        enum: ['install', 'remove', 'update', 'upgrade', 'list'],
        description: 'Action to perform',
      },
      packages: {
        type: 'array',
        items: { type: 'string' },
        description: 'List of package names (not required for update/upgrade/list)',
      },
      global: {
        type: 'boolean',
        description: 'Install globally (for npm/pnpm)',
      },
    },
    required: ['manager', 'action'],
  };

  private buildCommand(
    manager: string,
    action: string,
    packages: string[],
    global: boolean
  ): string {
    const pkgStr = packages.join(' ');

    switch (manager) {
      case 'apt':
        if (action === 'update') return 'sudo apt-get update -y';
        if (action === 'upgrade') return 'sudo apt-get upgrade -y';
        if (action === 'install') return `sudo apt-get install -y ${pkgStr}`;
        if (action === 'remove') return `sudo apt-get remove -y ${pkgStr}`;
        if (action === 'list') return 'dpkg --list';
        break;
      case 'npm':
        if (action === 'install') return `npm install ${global ? '-g ' : ''}${pkgStr}`;
        if (action === 'remove') return `npm uninstall ${global ? '-g ' : ''}${pkgStr}`;
        if (action === 'list') return `npm list ${global ? '-g ' : ''}--depth=0`;
        break;
      case 'pnpm':
        if (action === 'install') return `pnpm add ${global ? '-g ' : ''}${pkgStr}`;
        if (action === 'remove') return `pnpm remove ${global ? '-g ' : ''}${pkgStr}`;
        if (action === 'list') return 'pnpm list';
        break;
      case 'pip':
      case 'pip3':
        if (action === 'install') return `${manager} install ${pkgStr}`;
        if (action === 'remove') return `${manager} uninstall -y ${pkgStr}`;
        if (action === 'list') return `${manager} list`;
        break;
    }
    throw new Error(`Unsupported manager/action combination: ${manager}/${action}`);
  }

  async execute(params: {
    manager: string;
    action: string;
    packages?: string[];
    global?: boolean;
  }): Promise<ToolResult> {
    const { manager, action, packages = [], global: isGlobal = false } = params;

    try {
      const command = this.buildCommand(manager, action, packages, isGlobal);
      logger.info(`PackageManagerTool: ${command}`);

      const { stdout, stderr } = await execAsync(command, { timeout: 120000 });

      return {
        success: true,
        data: {
          command,
          stdout: stdout.trim(),
          stderr: stderr.trim(),
        },
      };
    } catch (error: any) {
      logger.error(`PackageManagerTool error`, { error });
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

export const packageManagerTool = new PackageManagerTool();
export default packageManagerTool;
