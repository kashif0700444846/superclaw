import { Bot, InlineKeyboard } from 'grammy';
import { NormalizedMessage, NormalizedResponse } from '../gateway/types';
import { gateway } from '../gateway/Gateway';
import { config } from '../config';
import { logger } from '../logger';

export class TelegramPlatform {
  private bot: Bot;
  private isRunning: boolean = false;

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

    // Handle all text messages (including commands)
    this.bot.on('message:text', async (ctx) => {
      const message: NormalizedMessage = {
        platform: 'telegram',
        userId: ctx.from!.id.toString(),
        chatId: ctx.chat.id.toString(),
        text: ctx.message.text,
        timestamp: new Date(ctx.message.date * 1000),
        messageId: ctx.message.message_id.toString(),
      };

      logger.debug(`Telegram message from ${ctx.from!.id}: ${ctx.message.text.substring(0, 80)}`);
      await gateway.receiveMessage(message);
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
      // If this is a confirmation request, send with inline keyboard
      if (response.confirmationId) {
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

      for (const chunk of chunks) {
        await this.bot.api.sendMessage(chatId, chunk, {
          parse_mode: response.parseMode === 'Markdown' ? 'Markdown' : undefined,
        });
      }
    } catch (error: any) {
      // If Markdown parsing fails, retry as plain text
      if (error.message?.includes('parse') || error.message?.includes('entities')) {
        try {
          await this.bot.api.sendMessage(chatId, response.text);
        } catch (retryError: any) {
          logger.error('Failed to send Telegram message', { error: retryError.message });
        }
      } else {
        logger.error('Failed to send Telegram message', { error: error.message });
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
