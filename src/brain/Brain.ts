import { NormalizedMessage, NormalizedResponse } from '../gateway/types';
import { conversationDB } from '../memory/ConversationDB';
import { memoryManager } from '../memory/MemoryManager';
import { promptBuilder } from './PromptBuilder';
import { functionCaller } from './FunctionCaller';
import { config } from '../config';
import { logger } from '../logger';
import { gateway } from '../gateway/Gateway';
import { agentOrchestrator } from '../agents/AgentOrchestrator';

export class Brain {
  async process(message: NormalizedMessage): Promise<NormalizedResponse[]> {
    const { platform, userId, chatId, text, timestamp } = message;

    logger.info(`Brain processing message from ${platform}:${userId}`);

    try {
      // STEP 1: Handle built-in commands
      const commandResponse = await this.handleBuiltinCommands(message);
      if (commandResponse) {
        return [commandResponse];
      }

      // STEP 2: Load conversation history
      const history = conversationDB.getHistory(userId, platform, 20);

      // STEP 3: Build system prompt
      const systemPrompt = promptBuilder.buildSystemPrompt(platform, userId);

      // STEP 4: Wire orchestrator to push sub-agent progress to this user/chat
      agentOrchestrator.setNotifyCallback((text: string) => {
        gateway.sendResponse({
          platform,
          chatId,
          text,
          parseMode: platform === 'telegram' ? 'Markdown' : 'plain',
        }).catch((err) => {
          logger.warn('Brain: failed to send sub-agent notification', { err });
        });
      });

      // STEP 5: Run AI decision loop
      const result = await functionCaller.run(
        systemPrompt,
        history,
        text,
        platform,
        chatId,
        userId
      );

      // STEP 6: Save conversation to DB
      conversationDB.addMessage(userId, platform, {
        role: 'user',
        content: text,
      });
      conversationDB.addMessage(userId, platform, {
        role: 'assistant',
        content: result.response,
      });

      // STEP 7: Auto-log to memory
      const summary = text.length > 100 ? text.substring(0, 100) + '...' : text;
      const outcome =
        result.toolsUsed.length > 0
          ? `Used tools: ${result.toolsUsed.join(', ')}`
          : 'Text response';
      memoryManager.appendTodayLog(platform, summary, outcome);

      // STEP 8: Format and return response
      const parseMode = platform === 'telegram' ? 'Markdown' : 'plain';
      return [
        {
          platform,
          chatId,
          text: result.response,
          parseMode,
        },
      ];
    } catch (error: any) {
      logger.error('Brain processing error', { error, userId, platform });
      return [
        {
          platform,
          chatId,
          text: `❌ Error: ${error.message}`,
          parseMode: 'plain',
        },
      ];
    }
  }

  private async handleBuiltinCommands(
    message: NormalizedMessage
  ): Promise<NormalizedResponse | null> {
    const { platform, chatId, text } = message;
    const cmd = text.trim().toLowerCase();

    if (cmd === '/start' || cmd === '!start') {
      const memory = memoryManager.readMemory();
      const memoryLines = memory.split('\n').filter((l) => l.trim()).length;
      const responseText =
        platform === 'telegram'
          ? `🟢 *${config.agentName} Online*\n\nTime: ${new Date().toISOString()}\nAI Model: ${config.aiModel}\nMemory entries: ${memoryLines}\n\nType /help to see available commands.`
          : `${config.agentName} Online\nTime: ${new Date().toISOString()}\nAI Model: ${config.aiModel}\nType !help for commands.`;
      return {
        platform,
        chatId,
        text: responseText,
        parseMode: platform === 'telegram' ? 'Markdown' : 'plain',
      };
    }

    if (cmd === '/help' || cmd === '!help') {
      const helpText =
        platform === 'telegram'
          ? `*${config.agentName} Commands*\n\n` +
            `/start — Agent status\n` +
            `/help — This help message\n` +
            `/memory — Show MEMORY.md\n` +
            `/logs — Show last 20 log lines\n` +
            `/status — VPS system status\n\n` +
            `*Direct Commands:*\n` +
            `\`!shell [cmd]\` — Run shell command\n` +
            `\`!remember [fact]\` — Save to memory\n` +
            `\`!ask [question]\` — Ask AI directly\n` +
            `\`!read [path]\` — Read a file\n` +
            `\`!status\` — System info\n` +
            `\`!restart\` — Restart agent\n\n` +
            `Or just type naturally: "install nginx", "show disk usage", etc.`
          : `${config.agentName} Commands:\n!start, !help, !memory, !logs, !status\n!shell [cmd], !remember [fact], !ask [q], !read [path], !restart`;
      return {
        platform,
        chatId,
        text: helpText,
        parseMode: platform === 'telegram' ? 'Markdown' : 'plain',
      };
    }

    if (cmd === '/memory' || cmd === '!memory') {
      const memory = memoryManager.readMemory();
      return {
        platform,
        chatId,
        text: memory || 'No memories yet.',
        parseMode: 'plain',
      };
    }

    if (cmd === '/logs' || cmd === '!logs') {
      const todayLog = memoryManager.readTodayLog();
      const lines = todayLog.split('\n').slice(-20).join('\n');
      return {
        platform,
        chatId,
        text: lines || 'No logs today.',
        parseMode: 'plain',
      };
    }

    if (cmd === '/status' || cmd === '!status') {
      // Delegate to AI with system_info tool
      return null;
    }

    // Handle !remember shortcut directly without AI
    if (text.startsWith('!remember ')) {
      const fact = text.substring('!remember '.length).trim();
      memoryManager.appendMemory(fact);
      return {
        platform,
        chatId,
        text: `✅ Remembered: ${fact}`,
        parseMode: 'plain',
      };
    }

    // All other commands (including !shell, !ask, !read, !restart, natural language)
    // are delegated to the AI function-calling loop
    return null;
  }
}

export const brain = new Brain();
export default brain;
