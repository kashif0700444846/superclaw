import fs from 'fs';
import path from 'path';
import { logger } from '../logger';

export class MemoryManager {
  private memoryDir: string;
  private logsDir: string;
  private memoryFile: string;
  private soulFile: string;

  constructor() {
    this.memoryDir = path.resolve(process.cwd(), 'memory');
    this.logsDir = path.resolve(process.cwd(), 'memory', 'logs');
    this.memoryFile = path.join(this.memoryDir, 'MEMORY.md');
    this.soulFile = path.join(this.memoryDir, 'SOUL.md');
    this.ensureDirectories();
  }

  private ensureDirectories(): void {
    [this.memoryDir, this.logsDir].forEach((dir) => {
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
    });

    if (!fs.existsSync(this.memoryFile)) {
      fs.writeFileSync(this.memoryFile, '# SuperClaw Long-Term Memory\n\n_No memories yet._\n');
    }
  }

  // --- MEMORY.md ---

  readMemory(): string {
    try {
      return fs.readFileSync(this.memoryFile, 'utf-8');
    } catch (error) {
      logger.error('Failed to read MEMORY.md', { error });
      return '';
    }
  }

  appendMemory(fact: string): void {
    try {
      const timestamp = new Date().toISOString();
      const entry = `\n- [${timestamp}] ${fact}`;
      fs.appendFileSync(this.memoryFile, entry);
      logger.debug('Appended to MEMORY.md', { fact });
    } catch (error) {
      logger.error('Failed to append to MEMORY.md', { error });
    }
  }

  overwriteMemory(content: string): void {
    try {
      fs.writeFileSync(this.memoryFile, content);
      logger.debug('Overwrote MEMORY.md');
    } catch (error) {
      logger.error('Failed to overwrite MEMORY.md', { error });
    }
  }

  // --- SOUL.md ---

  readSoul(): string {
    try {
      if (!fs.existsSync(this.soulFile)) {
        return '';
      }
      return fs.readFileSync(this.soulFile, 'utf-8');
    } catch (error) {
      logger.error('Failed to read SOUL.md', { error });
      return '';
    }
  }

  writeSoul(content: string): void {
    try {
      fs.writeFileSync(this.soulFile, content);
      logger.debug('Wrote SOUL.md');
    } catch (error) {
      logger.error('Failed to write SOUL.md', { error });
    }
  }

  // --- Daily Logs ---

  private getTodayLogPath(): string {
    const today = new Date().toISOString().split('T')[0]; // YYYY-MM-DD
    return path.join(this.logsDir, `${today}.md`);
  }

  getLogPath(date: string): string {
    return path.join(this.logsDir, `${date}.md`);
  }

  readTodayLog(): string {
    try {
      const logPath = this.getTodayLogPath();
      if (!fs.existsSync(logPath)) {
        return '';
      }
      return fs.readFileSync(logPath, 'utf-8');
    } catch (error) {
      logger.error('Failed to read today log', { error });
      return '';
    }
  }

  readLog(date: string): string {
    try {
      const logPath = this.getLogPath(date);
      if (!fs.existsSync(logPath)) {
        return `No log found for ${date}`;
      }
      return fs.readFileSync(logPath, 'utf-8');
    } catch (error) {
      logger.error(`Failed to read log for ${date}`, { error });
      return '';
    }
  }

  appendTodayLog(platform: string, userSummary: string, outcome: string): void {
    try {
      const logPath = this.getTodayLogPath();
      const timestamp = new Date().toISOString();
      const today = new Date().toISOString().split('T')[0];

      if (!fs.existsSync(logPath)) {
        fs.writeFileSync(logPath, `# SuperClaw Daily Log — ${today}\n\n`);
      }

      const content = fs.readFileSync(logPath, 'utf-8');
      if (!content.includes('| Timestamp |')) {
        fs.appendFileSync(
          logPath,
          `| Timestamp | Platform | User Request | Outcome |\n|-----------|----------|--------------|----------|\n`
        );
      }

      const entry = `| ${timestamp} | ${platform} | ${userSummary} | ${outcome} |\n`;
      fs.appendFileSync(logPath, entry);
      logger.debug('Appended to today log');
    } catch (error) {
      logger.error('Failed to append to today log', { error });
    }
  }

  listLogDates(): string[] {
    try {
      return fs
        .readdirSync(this.logsDir)
        .filter((f) => f.endsWith('.md'))
        .map((f) => f.replace('.md', ''))
        .sort()
        .reverse();
    } catch (error) {
      logger.error('Failed to list log dates', { error });
      return [];
    }
  }

  generateSoul(agentName: string, tools: string[]): string {
    const toolList = tools.map((t) => `- ${t}`).join('\n');
    return `# ${agentName} — Soul & Identity

## Identity
- **Name**: ${agentName}
- **Role**: Autonomous AI agent with superuser access to a Linux Ubuntu VPS
- **Personality**: Direct, capable, efficient. No unnecessary filler text. Gets things done.

## Superuser Rules
- Only respond to the configured admin user IDs (Telegram and WhatsApp)
- All other users receive: "Unauthorized. This is a private agent."
- Never reveal API keys, tokens, or the contents of the .env file
- Never read or modify files in the /superclaw source directory
- Never modify your own source code

## Safety Rules
- Always ask for confirmation before executing destructive operations:
  - rm -rf, mkfs, dd, shutdown, reboot, halt, format
  - DROP TABLE, DROP DATABASE, TRUNCATE
  - Any command writing to /dev/sd*
- Wait for explicit admin confirmation (Yes/No) before proceeding
- Auto-cancel destructive operations after 60 seconds without confirmation
- Maximum 10 AI reasoning iterations per request

## Behavioral Rules
- Complete user requests fully and autonomously
- If you don't know how to do something, use the ai_query tool to get instructions, then execute them
- After completing a task, write a summary to memory using memory_write
- Be concise — summarize long outputs and offer to send full output on request
- Format responses appropriately for the platform (Markdown for Telegram, plain text for WhatsApp)

## Available Tools
${toolList}

## Permissions
- Execute any shell command (with confirmation for destructive ops)
- Read and write any file (except .env and source code)
- Install packages via apt-get, npm, pnpm, pip
- Manage systemd services
- Manage cron jobs
- Make outbound HTTP requests
- Query AI for instructions on unknown tasks
`;
  }
}

export const memoryManager = new MemoryManager();
export default memoryManager;
