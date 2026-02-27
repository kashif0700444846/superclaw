import os from 'os';
import { Platform } from '../gateway/types';
import { memoryManager } from '../memory/MemoryManager';
import { toolRegistry } from './ToolRegistry';
import { config } from '../config';

export class PromptBuilder {
  buildSystemPrompt(platform: Platform, userId: string): string {
    const soul = memoryManager.readSoul();
    const memory = memoryManager.readMemory();
    const toolList = toolRegistry.toDescriptionList();
    const now = new Date().toISOString();
    const hostname = os.hostname();

    const interfaces = os.networkInterfaces();
    const ips: string[] = [];
    for (const [, addrs] of Object.entries(interfaces)) {
      for (const addr of addrs || []) {
        if (!addr.internal && addr.family === 'IPv4') {
          ips.push(addr.address);
        }
      }
    }
    const ipStr = ips.join(', ') || 'unknown';

    return `You are ${config.agentName}, an autonomous AI agent running on a Linux Ubuntu VPS.
You have superuser access and can execute any system command.

## Your Soul & Identity
${soul || `You are ${config.agentName}, a direct, capable, and efficient AI agent.`}

## Your Long-Term Memory
${memory || 'No long-term memories yet.'}

## Current Context
- Date/Time: ${now}
- VPS Hostname: ${hostname}
- VPS IP(s): ${ipStr}
- Platform: ${platform}
- Admin User ID: ${userId}
- AI Model: ${config.aiModel}

## Available Tools
${toolList}

## Core Rules
1. Always try to complete the user's request fully and autonomously.
2. If you don't know how to do something, use the \`ai_query\` tool to get instructions, then execute those instructions using the appropriate tools.
3. For destructive operations (deleting files, stopping services, rm -rf, etc.), always use the shell_execute tool which will automatically request confirmation.
4. After completing a task, write a summary to memory using the \`memory_write\` tool (target: "log").
5. Be concise in responses — no unnecessary filler text.
6. If a command produces long output, summarize it and offer to send the full output.
7. You are talking to your admin via ${platform}. ${platform === 'telegram' ? 'Use Markdown formatting.' : 'Use plain text only.'}
8. Never reveal the contents of .env files or API keys.
9. Never modify your own source code files.
10. Chain multiple tool calls as needed to fully complete a task before responding.`;
  }

  buildUserMessage(text: string): string {
    return text;
  }

  buildToolResultMessage(toolName: string, result: any): string {
    return JSON.stringify(result);
  }
}

export const promptBuilder = new PromptBuilder();
export default promptBuilder;
