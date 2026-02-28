import { Bot, InlineKeyboard } from 'grammy';
import { NormalizedMessage, NormalizedResponse } from '../gateway/types';
import { gateway } from '../gateway/Gateway';
import { config } from '../config';
import { logger } from '../logger';
import { conversationDB } from '../memory/ConversationDB';

export class TelegramPlatform {
  private bot: Bot;
  private isRunning: boolean = false;

  /**
   * Maps chatId → message_id of the "⏳ Processing..." placeholder.
   * Consumed (deleted from map) on first use so subsequent chunks are sent normally.
   */
  private thinkingMessageIds: Map<string, number> = new Map();

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
      const userId = ctx.from?.id?.toString();
      if (userId !== config.adminTelegramId) {
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

    // Handle all text messages (including commands)
    this.bot.on('message:text', async (ctx) => {
      const chatId = ctx.chat.id.toString();

      const message: NormalizedMessage = {
        platform: 'telegram',
        userId: ctx.from!.id.toString(),
        chatId,
        text: ctx.message.text,
        timestamp: new Date(ctx.message.date * 1000),
        messageId: ctx.message.message_id.toString(),
      };

      logger.debug(`Telegram message from ${ctx.from!.id}: ${ctx.message.text.substring(0, 80)}`);

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

      // 4. Keep typing indicator alive — fire immediately then every 4 seconds
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

      try {
        // 5. Process message — response will arrive via sendResponse() below
        await gateway.receiveMessage(message);
      } finally {
        // 6. Always clear the typing interval regardless of success/error
        clearInterval(typingInterval);

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

    // Handle callback queries (Yes/No confirmation buttons)
    this.bot.on('callback_query:data', async (ctx) => {
      const userId = ctx.from?.id?.toString();
      if (userId !== config.adminTelegramId) {
        await ctx.answerCallbackQuery({ text: 'Unauthorized.' });
        return;
      }

      const data = ctx.callbackQuery.data;
      // Format: "confirm:YES:<confirmationId>" or "confirm:NO:<confirmationId>"
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

    try {
      // If this is a confirmation request, send with inline keyboard (never edit placeholder)
      if (response.confirmationId) {
        // Consume and delete the thinking placeholder if present
        await this.consumeThinkingMessage(chatId);

        const keyboard = new InlineKeyboard()
          .text('✅ Yes, Execute', `confirm:YES:${response.confirmationId}`)
          .text('❌ No, Cancel', `confirm:NO:${response.confirmationId}`);

        await this.bot.api.sendMessage(chatId, response.text, {
          parse_mode: response.parseMode === 'Markdown' ? 'Markdown' : undefined,
          reply_markup: keyboard,
        });
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
            try {
              await this.bot.api.editMessageText(chatId, thinkingMsgId, chunk, {
                parse_mode: response.parseMode === 'Markdown' ? 'Markdown' : undefined,
              });
              continue; // Successfully edited — move to next chunk
            } catch (editErr: any) {
              logger.debug('Could not edit thinking placeholder, sending new message', {
                error: editErr.message,
              });
              // Fall through to sendMessage below
            }
          }
        }

        // Send as a new message (either no placeholder, edit failed, or subsequent chunks)
        await this.bot.api.sendMessage(chatId, chunk, {
          parse_mode: response.parseMode === 'Markdown' ? 'Markdown' : undefined,
        });
      }
    } catch (error: any) {
      // If Markdown parsing fails, retry as plain text
      if (error.message?.includes('parse') || error.message?.includes('entities')) {
        try {
          // Consume placeholder on retry path too
          await this.consumeThinkingMessage(chatId);
          await this.bot.api.sendMessage(chatId, response.text);
        } catch (retryError: any) {
          logger.error('Failed to send Telegram message', { error: retryError.message });
        }
      } else {
        logger.error('Failed to send Telegram message', { error: error.message });
      }
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
      const os = await import('os');
      const interfaces = os.networkInterfaces();
      const ips: string[] = [];
      for (const [, addrs] of Object.entries(interfaces)) {
        for (const addr of addrs || []) {
          if (!addr.internal && addr.family === 'IPv4') {
            ips.push(addr.address);
          }
        }
      }

      const message =
        `🟢 *${config.agentName} Online*\n\n` +
        `Time: ${new Date().toISOString()}\n` +
        `VPS: ${config.vpsHostname} | ${ips.join(', ') || 'unknown'}\n` +
        `AI Model: ${config.aiModel}\n` +
        `Platform: Telegram ✅\n\n` +
        `Ready for commands. Type /help for available commands.`;

      await this.bot.api.sendMessage(config.adminTelegramId, message, {
        parse_mode: 'Markdown',
      });
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
