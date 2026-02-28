import { Bot, InlineKeyboard } from 'grammy';
import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import { NormalizedMessage, NormalizedResponse } from '../gateway/types';
import { gateway } from '../gateway/Gateway';
import { config } from '../config';
import { logger } from '../logger';
import { conversationDB } from '../memory/ConversationDB';

// ---------------------------------------------------------------------------
// Helper: detect whether an error is an AI API connectivity / auth error
// ---------------------------------------------------------------------------
function isApiError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  const cause = (err as { cause?: { message?: string; code?: string } })?.cause;
  const causeMsg = cause?.message ?? '';
  const causeCode = cause?.code ?? '';
  const code = (err as { code?: string })?.code ?? '';
  const status = (err as { status?: number })?.status ?? 0;

  return (
    code === 'ENOTFOUND' || causeCode === 'ENOTFOUND' ||
    code === 'ECONNREFUSED' || causeCode === 'ECONNREFUSED' ||
    code === 'ETIMEDOUT' || causeCode === 'ETIMEDOUT' ||
    status === 401 || status === 403 ||
    status === 502 || status === 503 || status === 504 ||
    msg.includes('ENOTFOUND') || causeMsg.includes('ENOTFOUND') ||
    msg.includes('getaddrinfo') || causeMsg.includes('getaddrinfo') ||
    msg.includes('fetch failed') ||
    msg.includes('API key') ||
    msg.includes('Unauthorized')
  );
}

// ---------------------------------------------------------------------------
// Helper: update (or append) a key=value line in the .env file
// ---------------------------------------------------------------------------
function updateEnvVar(key: string, value: string): void {
  const envPath = path.join(process.cwd(), '.env');
  let content = fs.readFileSync(envPath, 'utf-8');
  const regex = new RegExp(`^${key}=.*$`, 'm');
  if (regex.test(content)) {
    content = content.replace(regex, `${key}=${value}`);
  } else {
    content += `\n${key}=${value}`;
  }
  fs.writeFileSync(envPath, content, 'utf-8');
}

// ---------------------------------------------------------------------------
// Helper: return the env-var name for the API key of the current provider
// ---------------------------------------------------------------------------
function apiKeyEnvVar(): string {
  switch (config.aiProvider) {
    case 'anthropic': return 'ANTHROPIC_API_KEY';
    case 'groq':      return 'GROQ_API_KEY';
    case 'custom':    return 'CUSTOM_AI_API_KEY';
    default:          return 'OPENAI_API_KEY';
  }
}

// ---------------------------------------------------------------------------
// Helper: send a message with Markdown, falling back to plain text on error
// ---------------------------------------------------------------------------
async function safeSendMessage(
  bot: Bot,
  chatId: string,
  text: string,
  extraOptions?: Record<string, unknown>,
): Promise<void> {
  try {
    await bot.api.sendMessage(chatId, text, {
      parse_mode: 'Markdown',
      ...extraOptions,
    });
  } catch {
    // Markdown failed (bad entities / unescaped chars) — send as plain text
    await bot.api.sendMessage(chatId, text, extraOptions);
  }
}

// ---------------------------------------------------------------------------
// Helper: edit a message with Markdown; if that fails, send a new plain-text
// message instead (edit is best-effort)
// ---------------------------------------------------------------------------
async function safeEditMessageText(
  bot: Bot,
  chatId: string,
  messageId: number,
  text: string,
): Promise<boolean> {
  // Try edit with Markdown
  try {
    await bot.api.editMessageText(chatId, messageId, text, {
      parse_mode: 'Markdown',
    });
    return true;
  } catch {
    // Markdown edit failed — try plain-text edit
    try {
      await bot.api.editMessageText(chatId, messageId, text);
      return true;
    } catch {
      // Edit entirely failed (message too old, deleted, etc.) — caller will send new message
      return false;
    }
  }
}

export class TelegramPlatform {
  private bot: Bot;
  private isRunning: boolean = false;

  /**
   * Maps chatId → message_id of the "⏳ Processing..." placeholder.
   * Consumed (deleted from map) on first use so subsequent chunks are sent normally.
   */
  private thinkingMessageIds: Map<string, number> = new Map();

  /**
   * Maps chatId → active typing interval handle.
   * Cleared when a response is sent (in sendResponse) or on error.
   */
  private typingIntervals: Map<string, NodeJS.Timeout> = new Map();

  /**
   * Tracks per-user recovery state:
   *   'awaiting_base_url' — next text message is a new CUSTOM_AI_BASE_URL
   *   'awaiting_api_key'  — next text message is a new API key
   */
  private userState: Map<string, string> = new Map();

  constructor() {
    this.bot = new Bot(config.telegramBotToken);
    this.setupHandlers();
    this.registerWithGateway();
  }

  private registerWithGateway(): void {
    gateway.registerPlatform('telegram', async (response: NormalizedResponse) => {
      await this.sendResponse(response);
    });
  }

  private setupHandlers(): void {
    // Middleware: auth check for every message
    this.bot.use(async (ctx, next) => {
      const userId = ctx.from?.id;
      const adminIds = config.adminTelegramIds.length > 0
        ? config.adminTelegramIds
        : [parseInt(config.adminTelegramId, 10)];
      if (!userId || !adminIds.includes(userId)) {
        await ctx.reply('Unauthorized. This is a private agent.');
        return;
      }
      await next();
    });

    // /clear command — clears conversation history for the current user
    this.bot.command('clear', async (ctx) => {
      const userId = ctx.from!.id.toString();
      const chatId = ctx.chat.id.toString();
      try {
        conversationDB.clearHistory(userId, 'telegram');
        await ctx.reply('✅ Conversation history cleared! Starting fresh. 🚀');
        logger.info(`Telegram /clear: cleared history for user ${userId}`);
      } catch (err: any) {
        logger.error('Failed to clear history via /clear command', { error: err.message });
        await ctx.reply('❌ Failed to clear history. Please try again.');
      }
    });

    // Handle all text messages — SKIP commands (they are handled by their own handlers above)
    this.bot.on('message:text', async (ctx) => {
      const userId = ctx.from!.id.toString();
      const chatId = ctx.chat.id.toString();
      const text = ctx.message.text;

      // -----------------------------------------------------------------------
      // STATE: awaiting_base_url — user is providing a new CUSTOM_AI_BASE_URL
      // -----------------------------------------------------------------------
      if (this.userState.get(userId) === 'awaiting_base_url') {
        this.userState.delete(userId);
        const newUrl = text.trim();
        try {
          updateEnvVar('CUSTOM_AI_BASE_URL', newUrl);
          await ctx.reply('✅ Base URL updated! Restarting...');
          logger.info(`API recovery: CUSTOM_AI_BASE_URL updated to ${newUrl}`);
          try {
            execSync('pm2 restart superclaw');
          } catch (restartErr: any) {
            logger.warn('PM2 restart failed (may not be running under PM2)', { error: restartErr.message });
            await ctx.reply('⚠️ Could not restart via PM2. Please restart manually.');
          }
        } catch (err: any) {
          logger.error('Failed to update CUSTOM_AI_BASE_URL', { error: err.message });
          await ctx.reply(`❌ Failed to update .env: ${err.message}`);
        }
        return;
      }

      // -----------------------------------------------------------------------
      // STATE: awaiting_api_key — user is providing a new API key
      // -----------------------------------------------------------------------
      if (this.userState.get(userId) === 'awaiting_api_key') {
        this.userState.delete(userId);
        const newKey = text.trim();
        const envKey = apiKeyEnvVar();
        try {
          updateEnvVar(envKey, newKey);
          await ctx.reply('✅ API key updated! Restarting...');
          logger.info(`API recovery: ${envKey} updated`);
          try {
            execSync('pm2 restart superclaw');
          } catch (restartErr: any) {
            logger.warn('PM2 restart failed (may not be running under PM2)', { error: restartErr.message });
            await ctx.reply('⚠️ Could not restart via PM2. Please restart manually.');
          }
        } catch (err: any) {
          logger.error(`Failed to update ${envKey}`, { error: err.message });
          await ctx.reply(`❌ Failed to update .env: ${err.message}`);
        }
        return;
      }

      // Skip command messages — they are handled by dedicated command handlers.
      // Without this guard, /clear (and other commands) would be processed TWICE:
      // once by the command handler and once here, causing cleared history to be
      // immediately re-populated by Brain.
      if (text.startsWith('/')) return;

      const message: NormalizedMessage = {
        platform: 'telegram',
        userId,
        chatId,
        text,
        timestamp: new Date(ctx.message.date * 1000),
        messageId: ctx.message.message_id.toString(),
      };

      logger.debug(`Telegram message from ${ctx.from!.id}: ${text.substring(0, 80)}`);

      // 1. Send typing action immediately (await ensures it's dispatched before processing)
      try {
        await this.bot.api.sendChatAction(ctx.chat.id, 'typing');
      } catch {
        // Non-fatal — ignore
      }

      // 2. Send "⏳ Processing..." placeholder and store its message_id
      let thinkingMsgId: number | undefined;
      try {
        const thinkingMsg = await this.bot.api.sendMessage(chatId, '⏳ Processing your request...');
        thinkingMsgId = thinkingMsg.message_id;
        this.thinkingMessageIds.set(chatId, thinkingMsgId);
      } catch (err: any) {
        logger.warn('Failed to send thinking placeholder', { error: err.message });
      }

      // 3. Small delay to ensure Telegram delivers the placeholder before processing starts
      await new Promise(resolve => setTimeout(resolve, 100));

      // 4. Keep typing indicator alive — fire immediately then every 4 seconds.
      //    Store in class-level Map so sendResponse() can clear it as soon as
      //    the first response chunk is ready (before gateway.receiveMessage resolves).
      try {
        await this.bot.api.sendChatAction(ctx.chat.id, 'typing');
      } catch {
        // Non-fatal — ignore
      }
      const typingInterval = setInterval(async () => {
        try {
          await this.bot.api.sendChatAction(ctx.chat.id, 'typing');
        } catch {
          // Ignore — bot may have been stopped
        }
      }, 4000);
      this.typingIntervals.set(chatId, typingInterval);

      try {
        // 5. Process message — response will arrive via sendResponse() below
        await gateway.receiveMessage(message);
      } catch (err: unknown) {
        this.clearTypingInterval(chatId);
        logger.error('Brain processing error', { error: err, userId, platform: 'telegram' });

        const errorMsg = err instanceof Error ? err.message : String(err);
        const isConnError = isApiError(err);

        // Always show recovery options when AI fails
        const recoveryText = isConnError
          ? `❌ AI API Error\n\nThe AI provider is not responding (${errorMsg.slice(0, 100)}).\n\nWhat would you like to do?`
          : `❌ AI Error\n\n${errorMsg.slice(0, 200)}\n\nIf this keeps happening, you may need to update your API settings:`;

        const keyboard = new InlineKeyboard()
          .text('🔗 Update Base URL', 'update_base_url')
          .text('🔑 Update API Key', 'update_api_key')
          .row()
          .text('🔄 Retry (send your message again)', 'retry_api');

        try {
          if (thinkingMsgId) {
            await this.bot.api.editMessageText(chatId, thinkingMsgId, recoveryText, { reply_markup: keyboard });
            this.thinkingMessageIds.delete(chatId);
          } else {
            await this.bot.api.sendMessage(chatId, recoveryText, { reply_markup: keyboard });
          }
        } catch {
          // If even that fails, send plain text
          await ctx.reply('❌ AI error. Please check your API settings and try again.').catch(() => {});
        }
        return;
      } finally {
        // Always clear the typing interval regardless of success/error
        this.clearTypingInterval(chatId);

        // If the placeholder was never consumed (e.g. gateway returned nothing or
        // an error path skipped sendResponse), clean it up now.
        if (this.thinkingMessageIds.has(chatId)) {
          this.thinkingMessageIds.delete(chatId);
          if (thinkingMsgId !== undefined) {
            try {
              await this.bot.api.deleteMessage(chatId, thinkingMsgId);
            } catch {
              // Ignore — message may already be gone
            }
          }
        }
      }
    });

    // Handle callback queries (Yes/No confirmation buttons + API recovery buttons)
    this.bot.on('callback_query:data', async (ctx) => {
      const userId = ctx.from?.id;
      const adminIds = config.adminTelegramIds.length > 0
        ? config.adminTelegramIds
        : [parseInt(config.adminTelegramId, 10)];
      if (!userId || !adminIds.includes(userId)) {
        await ctx.answerCallbackQuery({ text: 'Unauthorized.' });
        return;
      }

      const userIdStr = String(userId);
      const data = ctx.callbackQuery.data;
      const chatId = ctx.chat?.id?.toString() ?? ctx.from.id.toString();

      // ------------------------------------------------------------------
      // API recovery callbacks
      // ------------------------------------------------------------------
      if (data === 'update_base_url') {
        this.userState.set(userIdStr, 'awaiting_base_url');
        await ctx.answerCallbackQuery({ text: 'Send the new base URL' });
        try {
          await ctx.editMessageReplyMarkup({ reply_markup: undefined });
        } catch { /* ignore */ }
        await this.bot.api.sendMessage(
          chatId,
          'Please send the new base URL (e.g., https://your-tunnel.trycloudflare.com/v1):'
        );
        return;
      }

      if (data === 'update_api_key') {
        this.userState.set(userIdStr, 'awaiting_api_key');
        await ctx.answerCallbackQuery({ text: 'Send the new API key' });
        try {
          await ctx.editMessageReplyMarkup({ reply_markup: undefined });
        } catch { /* ignore */ }
        await this.bot.api.sendMessage(chatId, 'Please send the new API key:');
        return;
      }

      if (data === 'retry_api') {
        await ctx.answerCallbackQuery({
          text: '🔄 Please try sending your message again.',
          show_alert: false,
        });
        try {
          await ctx.editMessageReplyMarkup({ reply_markup: undefined });
        } catch { /* ignore */ }
        return;
      }

      // ------------------------------------------------------------------
      // Confirmation callbacks: "confirm:YES:<id>" or "confirm:NO:<id>"
      // ------------------------------------------------------------------
      if (data.startsWith('confirm:')) {
        const parts = data.split(':');
        const answer = parts[1]; // YES or NO
        const confirmationId = parts[2];

        const confirmed = answer === 'YES';
        await gateway.handleConfirmation(confirmationId, confirmed);
        await ctx.answerCallbackQuery({ text: confirmed ? '✅ Confirmed' : '❌ Cancelled' });

        // Edit the original message to remove buttons
        try {
          await ctx.editMessageReplyMarkup({ reply_markup: undefined });
        } catch {
          // Ignore if message can't be edited
        }
      }
    });

    // Handle voice messages
    this.bot.on('message:voice', async (ctx) => {
      await ctx.reply('Voice messages are not yet supported. Please send text commands.');
    });

    // Handle documents
    this.bot.on('message:document', async (ctx) => {
      await ctx.reply('Document received. File handling via text commands: use !read or !write.');
    });

    // Error handler
    this.bot.catch((err) => {
      logger.error('Telegram bot error', { error: err.message });
    });
  }

  private async sendResponse(response: NormalizedResponse): Promise<void> {
    const chatId = response.chatId;

    // Stop the typing indicator as soon as we have a response ready to send
    this.clearTypingInterval(chatId);

    try {
      // If this is a confirmation request, send with inline keyboard (never edit placeholder)
      if (response.confirmationId) {
        // Consume and delete the thinking placeholder if present
        await this.consumeThinkingMessage(chatId);

        const keyboard = new InlineKeyboard()
          .text('✅ Yes, Execute', `confirm:YES:${response.confirmationId}`)
          .text('❌ No, Cancel', `confirm:NO:${response.confirmationId}`);

        // AI-generated content — use safe send (Markdown → plain text fallback)
        await safeSendMessage(this.bot, chatId, response.text, { reply_markup: keyboard });
        return;
      }

      // Split long messages (Telegram limit: 4096 chars)
      const text = response.text || '(empty response)';
      const chunks = this.splitMessage(text, 4096);

      for (let i = 0; i < chunks.length; i++) {
        const chunk = chunks[i];

        // On the first chunk, try to edit the thinking placeholder
        if (i === 0) {
          const thinkingMsgId = this.thinkingMessageIds.get(chatId);
          if (thinkingMsgId !== undefined) {
            this.thinkingMessageIds.delete(chatId);
            // safeEditMessageText tries Markdown edit, then plain-text edit
            const edited = await safeEditMessageText(this.bot, chatId, thinkingMsgId, chunk);
            if (edited) {
              continue; // Successfully edited — move to next chunk
            }
            logger.debug('Could not edit thinking placeholder, sending new message');
            // Fall through to safeSendMessage below
          }
        }

        // Send as a new message (either no placeholder, edit failed, or subsequent chunks)
        // AI-generated content — use safe send (Markdown → plain text fallback)
        await safeSendMessage(this.bot, chatId, chunk);
      }
    } catch (error: any) {
      logger.error('Failed to send Telegram message', { error: error.message });
    }
  }

  /**
   * Clear the typing interval for a given chatId (if any).
   * Safe to call multiple times — no-op if no interval is active.
   */
  private clearTypingInterval(chatId: string): void {
    const interval = this.typingIntervals.get(chatId);
    if (interval !== undefined) {
      clearInterval(interval);
      this.typingIntervals.delete(chatId);
    }
  }

  /**
   * If a thinking placeholder exists for this chatId, delete it and remove from map.
   * Used when we need to send a fresh message instead of editing.
   */
  private async consumeThinkingMessage(chatId: string): Promise<void> {
    const thinkingMsgId = this.thinkingMessageIds.get(chatId);
    if (thinkingMsgId !== undefined) {
      this.thinkingMessageIds.delete(chatId);
      try {
        await this.bot.api.deleteMessage(chatId, thinkingMsgId);
      } catch {
        // Ignore — message may already be gone or too old
      }
    }
  }

  private splitMessage(text: string, maxLength: number): string[] {
    if (text.length <= maxLength) return [text];

    const chunks: string[] = [];
    let remaining = text;

    while (remaining.length > 0) {
      if (remaining.length <= maxLength) {
        chunks.push(remaining);
        break;
      }

      // Try to split at a newline
      let splitAt = remaining.lastIndexOf('\n', maxLength);
      if (splitAt === -1 || splitAt < maxLength / 2) {
        splitAt = maxLength;
      }

      chunks.push(remaining.substring(0, splitAt));
      remaining = remaining.substring(splitAt).trimStart();
    }

    return chunks;
  }

  async sendStartupMessage(): Promise<void> {
    try {
      const message =
        `🟢 *${config.agentName} Online*\n` +
        `Ready for commands. Type /help for available commands.`;

      // Send startup message to all configured admin IDs
      const adminIds = config.adminTelegramIds.length > 0
        ? config.adminTelegramIds
        : [parseInt(config.adminTelegramId, 10)];
      for (const adminId of adminIds) {
        await safeSendMessage(this.bot, String(adminId), message);
      }
    } catch (error: any) {
      logger.warn('Failed to send Telegram startup message', { error: error.message });
    }
  }

  async start(): Promise<void> {
    if (this.isRunning) return;
    this.isRunning = true;

    logger.info('Starting Telegram bot...');

    // Send startup message
    await this.sendStartupMessage();

    // Start polling
    this.bot.start({
      onStart: (botInfo) => {
        logger.info(`Telegram bot started: @${botInfo.username}`);
      },
    });
  }

  async stop(): Promise<void> {
    if (!this.isRunning) return;
    this.isRunning = false;
    await this.bot.stop();
    logger.info('Telegram bot stopped');
  }

  getBot(): Bot {
    return this.bot;
  }
}

export const telegramPlatform = new TelegramPlatform();
export default telegramPlatform;
