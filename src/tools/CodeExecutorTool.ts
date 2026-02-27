import { exec } from 'child_process';
import { promisify } from 'util';
import fs from 'fs';
import path from 'path';
import os from 'os';
import crypto from 'crypto';
import { Tool, ToolResult } from '../gateway/types';
import { logger } from '../logger';

const execAsync = promisify(exec);

export class CodeExecutorTool implements Tool {
  name = 'code_executor';
  description = 'Executes Python, Bash, or Node.js code snippets in a temporary sandbox. Returns stdout, stderr, and exit code.';
  parameters = {
    type: 'object',
    properties: {
      language: {
        type: 'string',
        enum: ['python', 'python3', 'bash', 'sh', 'node', 'nodejs'],
        description: 'Programming language to execute',
      },
      code: {
        type: 'string',
        description: 'Code to execute',
      },
      timeout: {
        type: 'number',
        description: 'Execution timeout in milliseconds (default: 30000)',
      },
    },
    required: ['language', 'code'],
  };

  private getExtension(language: string): string {
    switch (language) {
      case 'python':
      case 'python3':
        return '.py';
      case 'bash':
      case 'sh':
        return '.sh';
      case 'node':
      case 'nodejs':
        return '.js';
      default:
        return '.txt';
    }
  }

  private getInterpreter(language: string): string {
    switch (language) {
      case 'python':
        return 'python';
      case 'python3':
        return 'python3';
      case 'bash':
        return 'bash';
      case 'sh':
        return 'sh';
      case 'node':
      case 'nodejs':
        return 'node';
      default:
        return language;
    }
  }

  async execute(params: {
    language: string;
    code: string;
    timeout?: number;
  }): Promise<ToolResult> {
    const { language, code, timeout = 30000 } = params;

    const ext = this.getExtension(language);
    const interpreter = this.getInterpreter(language);
    const tmpFile = path.join(os.tmpdir(), `superclaw_${crypto.randomUUID()}${ext}`);

    logger.info(`CodeExecutorTool executing ${language} code (${code.length} chars)`);

    try {
      fs.writeFileSync(tmpFile, code);

      if (language === 'bash' || language === 'sh') {
        fs.chmodSync(tmpFile, '755');
      }

      const startTime = Date.now();
      const { stdout, stderr } = await execAsync(`${interpreter} "${tmpFile}"`, {
        timeout,
        maxBuffer: 1024 * 1024 * 5,
      });
      const duration = Date.now() - startTime;

      return {
        success: true,
        data: {
          stdout: stdout.trim(),
          stderr: stderr.trim(),
          exitCode: 0,
          duration,
          language,
        },
      };
    } catch (error: any) {
      return {
        success: false,
        data: {
          stdout: error.stdout?.trim() || '',
          stderr: error.stderr?.trim() || error.message,
          exitCode: error.code || 1,
          language,
        },
        error: error.message,
      };
    } finally {
      try {
        if (fs.existsSync(tmpFile)) {
          fs.unlinkSync(tmpFile);
        }
      } catch {
        // Ignore cleanup errors
      }
    }
  }
}

export const codeExecutorTool = new CodeExecutorTool();
export default codeExecutorTool;
