import { NormalizedMessage, NormalizedResponse } from '../gateway/types';
import { getConversationDB } from '../memory/ConversationDB';
import { memoryManager } from '../memory/MemoryManager';
import { promptBuilder } from './PromptBuilder';
import { functionCaller } from './FunctionCaller';
import { config } from '../config';
import { logger } from '../logger';
import { gateway } from '../gateway/Gateway';
import { agentOrchestrator } from '../agents/AgentOrchestrator';

/**
 * Maximum number of conversation history messages sent to the AI per request.
 * If history exceeds CONTEXT_WINDOW_MAX_MESSAGES, it is trimmed to
 * CONTEXT_WINDOW_TRIM_TO messages (keeping the system prompt).
 */
const MAX_HISTORY_MESSAGES = 20;
const CONTEXT_WINDOW_MAX_MESSAGES = 40;
const CONTEXT_WINDOW_TRIM_TO = 20;

/**
 * Maximum number of enforcement re-prompts when the AI returns a text-only
 * response for an action request (hallucination enforcement).
 */
const MAX_ENFORCEMENT_RETRIES = 2;

/**
 * Action keywords — if the user's message contains any of these, it is
 * considered an action request and the AI MUST call a tool to respond.
 */
const ACTION_KEYWORDS = [
  'create', 'make', 'write', 'run', 'execute', 'install', 'setup', 'configure',
  'delete', 'remove', 'update', 'change', 'modify', 'edit', 'add', 'build',
  'deploy', 'start', 'stop', 'restart', 'download', 'upload', 'send', 'move',
  'copy', 'rename', 'fix', 'implement', 'generate', 'set up', 'set', 'enable',
  'disable', 'open', 'close', 'connect', 'disconnect', 'save', 'load',
  'install', 'uninstall', 'upgrade', 'downgrade', 'check', 'show', 'list',
  'search', 'find', 'get', 'fetch', 'pull', 'push', 'clone', 'init',
];

/**
 * Completion claim patterns — if the AI response matches any of these AND
 * no tools were called, it is a hallucination.
 */
const COMPLETION_CLAIM_PATTERN =
  /\b(I('ve| have) (created|written|run|executed|installed|set up|configured|done|completed|built|deployed|started|stopped|deleted|removed|updated|changed|modified|added|generated|saved|loaded|sent|moved|copied|renamed|fixed|implemented|enabled|disabled|set|opened|closed|connected|disconnected|fetched|pulled|pushed|cloned|initialized|upgraded|downgraded|uninstalled|searched|found|checked|listed|showed|got))\b/i;

const DONE_PATTERN = /^(Done|Complete|Finished|All set|Ready|Success|Completed)[.!]?\s*$/im;

/**
 * Returns true if the user's message is requesting an action (not just a question
 * or greeting). Used to decide whether to enforce tool usage.
 */
function isActionRequest(message: string): boolean {
  const lower = message.toLowerCase();

  // Exclude pure greetings and questions
  const greetingPatterns = [
    /^(hello|hi|hey|good morning|good afternoon|good evening|how are you|what's up|sup)\b/i,
    /^(thanks|thank you|thx|ty)\b/i,
    /^(what can you do|what are you|who are you|tell me about yourself)\b/i,
  ];
  for (const pattern of greetingPatterns) {
    if (pattern.test(message.trim())) return false;
  }

  // Check for action keywords
  return ACTION_KEYWORDS.some((keyword) => {
    // Use word boundary matching to avoid false positives
    const regex = new RegExp(`\\b${keyword.replace(/\s+/g, '\\s+')}\\b`, 'i');
    return regex.test(lower);
  });
}

/**
 * Returns true if the AI response appears to be a hallucination:
 * - No tools were called this turn (toolsCalledCount === 0)
 * - AND the response contains completion claim language
 */
function detectsHallucination(response: string, toolsCalledCount: number): boolean {
  if (toolsCalledCount > 0) return false;
  return COMPLETION_CLAIM_PATTERN.test(response) || DONE_PATTERN.test(response);
}

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

      // STEP 2: Load conversation history (capped at MAX_HISTORY_MESSAGES)
      let history = getConversationDB().getHistory(userId, platform, MAX_HISTORY_MESSAGES);

      // STEP 3: Context window guard — trim if history is too long
      if (history.length > CONTEXT_WINDOW_MAX_MESSAGES) {
        logger.warn('Brain: context window guard triggered — trimming conversation history', {
          before: history.length,
          after: CONTEXT_WINDOW_TRIM_TO,
          userId,
          platform,
        });
        history = history.slice(-CONTEXT_WINDOW_TRIM_TO);
      }

      // STEP 4: Build system prompt
      const systemPrompt = promptBuilder.buildSystemPrompt(platform, userId);

      // STEP 5: Wire orchestrator to push sub-agent progress to this user/chat
      agentOrchestrator.setNotifyCallback((notifyText: string) => {
        gateway.sendResponse({
          platform,
          chatId,
          text: notifyText,
          parseMode: platform === 'telegram' ? 'Markdown' : 'plain',
        }).catch((err) => {
          logger.warn('Brain: failed to send sub-agent notification', { err });
        });
      });

      // STEP 6: Run AI decision loop with hallucination enforcement
      let result = await functionCaller.run(
        systemPrompt,
        history,
        text,
        platform,
        chatId,
        userId
      );

      // STEP 7: Hallucination enforcement loop
      // If the AI returned a text-only response for an action request and the
      // response contains completion claims, re-prompt up to MAX_ENFORCEMENT_RETRIES times.
      if (isActionRequest(text)) {
        let enforcementAttempts = 0;

        while (
          enforcementAttempts < MAX_ENFORCEMENT_RETRIES &&
          detectsHallucination(result.response, result.toolsCalledCount)
        ) {
          enforcementAttempts++;
          logger.warn(
            `Brain: hallucination detected — AI claimed action without tool call (enforcement attempt ${enforcementAttempts}/${MAX_ENFORCEMENT_RETRIES})`,
            {
              userId,
              platform,
              responseSnippet: result.response.substring(0, 200),
              toolsCalledCount: result.toolsCalledCount,
            }
          );

          const enforcementMessage =
            `You described performing an action but did not call any tools. ` +
            `You MUST call the appropriate tool to actually perform the action. ` +
            `The original request was: "${text}". ` +
            `Please call the tool now — do not describe what you would do, just call it.`;

          // Build an augmented history that includes the original user message,
          // the hallucinated assistant response, and the enforcement prompt
          const augmentedHistory = [
            ...history,
            { role: 'user' as const, content: text, timestamp },
            { role: 'assistant' as const, content: result.response, timestamp: new Date() },
          ];

          result = await functionCaller.run(
            systemPrompt,
            augmentedHistory,
            enforcementMessage,
            platform,
            chatId,
            userId
          );
        }

        // If still hallucinating after all retries, log a final warning
        if (detectsHallucination(result.response, result.toolsCalledCount)) {
          logger.error(
            'Brain: hallucination enforcement failed — AI still claiming actions without tool calls after max retries',
            {
              userId,
              platform,
              enforcementAttempts: MAX_ENFORCEMENT_RETRIES,
              responseSnippet: result.response.substring(0, 200),
            }
          );
        }
      } else if (result.toolsCalledCount === 0) {
        // Non-action request with no tools — just log at debug level (normal for greetings/questions)
        logger.debug('Brain: AI responded without tools (non-action request)', {
          userId,
          platform,
          responseSnippet: result.response.substring(0, 100),
        });
      }

      // STEP 8: Save conversation to DB
      getConversationDB().addMessage(userId, platform, {
        role: 'user',
        content: text,
      });
      getConversationDB().addMessage(userId, platform, {
        role: 'assistant',
        content: result.response,
      });

      // STEP 9: Auto-log to memory
      const summary = text.length > 100 ? text.substring(0, 100) + '...' : text;
      const outcome =
        result.toolsUsed.length > 0
          ? `Used tools: ${result.toolsUsed.join(', ')}`
          : 'Text response (no tools used)';
      memoryManager.appendTodayLog(platform, summary, outcome);

      // STEP 10: Format and return response
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
