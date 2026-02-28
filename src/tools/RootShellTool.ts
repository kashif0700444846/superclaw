import { execSync } from 'child_process';
import fs from 'fs';
import { Tool, ToolResult } from '../gateway/types';
import { logger } from '../logger';

/**
 * Destructive shell patterns that require explicit confirmation before execution.
 * Mirrors the patterns used in ShellTool to maintain consistent safety behaviour.
 */
const DESTRUCTIVE_PATTERNS: string[] = [
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
  'fdisk',
  'parted',
  'wipefs',
  'shred',
];

/**
 * RootShellTool — executes shell commands with root (superuser) privileges.
 *
 * On Android/Termux it uses `su -c "command"`.
 * On Linux VPS systems it can optionally use `sudo sh -c "command"`.
 *
 * All root command executions are logged at WARN level.
 * Destructive commands are blocked and return a special result that requires
 * the caller to confirm before re-submitting.
 */
export class RootShellTool implements Tool {
  name = 'root_shell';
  description =
    "Execute shell commands with root (superuser) privileges using 'su'. Only available on rooted Android devices or Linux systems with sudo. Use for privileged operations like accessing system files, modifying system settings, or controlling hardware. DANGEROUS: Always confirm destructive operations.";

  parameters = {
    type: 'object',
    properties: {
      command: {
        type: 'string',
        description: 'The command to execute as root',
      },
      timeout: {
        type: 'number',
        description: 'Timeout in milliseconds (default: 30000)',
      },
      use_sudo: {
        type: 'boolean',
        description:
          "Use 'sudo' instead of 'su -c' (for Linux VPS environments). Default: false",
      },
    },
    required: ['command'],
  };

  // ── Availability detection ────────────────────────────────────────────────

  /** Returns the path to the `su` binary if found, otherwise null. */
  private findSu(): string | null {
    const candidates = [
      '/system/bin/su',
      '/sbin/su',
      '/system/xbin/su',
      '/system/sd/xbin/su',
    ];
    for (const p of candidates) {
      try {
        if (fs.existsSync(p)) return p;
      } catch {
        // ignore
      }
    }
    // Fall back to PATH lookup
    try {
      const result = execSync('which su 2>/dev/null', { encoding: 'utf8', timeout: 5000 }).trim();
      if (result) return result;
    } catch {
      // not found
    }
    return null;
  }

  /** Returns true if `sudo` is available on PATH. */
  private hasSudo(): boolean {
    try {
      const result = execSync('which sudo 2>/dev/null', { encoding: 'utf8', timeout: 5000 }).trim();
      return result.length > 0;
    } catch {
      return false;
    }
  }

  // ── Safety check ─────────────────────────────────────────────────────────

  private isDestructive(command: string): boolean {
    return DESTRUCTIVE_PATTERNS.some((pattern) =>
      command.toLowerCase().includes(pattern.toLowerCase())
    );
  }

  // ── Execution ─────────────────────────────────────────────────────────────

  async execute(params: {
    command: string;
    timeout?: number;
    use_sudo?: boolean;
  }): Promise<ToolResult> {
    const { command, timeout = 30000, use_sudo = false } = params;

    // ── Destructive guard ────────────────────────────────────────────────
    if (this.isDestructive(command)) {
      logger.warn(`RootShellTool blocked destructive command: ${command}`);
      return {
        success: false,
        error:
          `Destructive command detected: "${command}". ` +
          'This command requires explicit confirmation before execution with root privileges. ' +
          'Please confirm you want to run this as root.',
        data: { requires_confirmation: true, command },
      };
    }

    // ── Availability check ───────────────────────────────────────────────
    if (use_sudo) {
      if (!this.hasSudo()) {
        return {
          success: false,
          error: 'sudo is not available on this system. Try use_sudo: false to use su instead.',
        };
      }
    } else {
      const suPath = this.findSu();
      if (!suPath) {
        return {
          success: false,
          error:
            'su binary not found at /system/bin/su, /sbin/su, /system/xbin/su, or on PATH. ' +
            'This device may not be rooted. Try use_sudo: true for Linux VPS environments.',
        };
      }
    }

    // ── Build privileged command ─────────────────────────────────────────
    const escapedCommand = command.replace(/"/g, '\\"');
    const privilegedCommand = use_sudo
      ? `sudo sh -c "${escapedCommand}"`
      : `su -c "${escapedCommand}"`;

    logger.warn(`RootShellTool executing as root: ${command}`, {
      privilegedCommand,
      use_sudo,
    });

    const startTime = Date.now();
    try {
      const stdout = execSync(privilegedCommand, {
        encoding: 'utf8',
        timeout,
      });
      const duration = Date.now() - startTime;

      return {
        success: true,
        data: {
          stdout: stdout.trim(),
          stderr: '',
          exitCode: 0,
          duration,
          ran_as: use_sudo ? 'sudo' : 'su',
        },
      };
    } catch (error: any) {
      const duration = Date.now() - startTime;
      const stdout: string = error.stdout?.toString().trim() ?? '';
      const stderr: string = error.stderr?.toString().trim() ?? error.message;

      logger.error(`RootShellTool error executing: ${command}`, {
        error: error.message,
        stderr,
      });

      return {
        success: false,
        data: {
          stdout,
          stderr,
          exitCode: error.status ?? 1,
          duration,
          ran_as: use_sudo ? 'sudo' : 'su',
        },
        error: error.message,
      };
    }
  }
}

export const rootShellTool = new RootShellTool();
export default rootShellTool;
