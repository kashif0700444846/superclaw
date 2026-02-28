import { Client, LocalAuth, Message } from 'whatsapp-web.js';
import qrcode from 'qrcode-terminal';
import path from 'path';
import { NormalizedMessage, NormalizedResponse } from '../gateway/types';
import { gateway } from '../gateway/Gateway';
import { config } from '../config';
import { logger } from '../logger';

// Track pending confirmations waiting for WhatsApp reply
const pendingWhatsAppConfirmations = new Map<string, string>(); // chatId -> confirmationId

export class WhatsAppPlatform {
  private client: Client;
  private isReady: boolean = false;

  constructor() {
    const sessionPath = path.resolve(process.cwd(), 'whatsapp-session');

    this.client = new Client({
      authStrategy: new LocalAuth({
        clientId: config.whatsappSessionName,
        dataPath: sessionPath,
      }),
      puppeteer: {
        headless: true,
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-dev-shm-usage',
          '--disable-accelerated-2d-canvas',
          '--no-first-run',
          '--no-zygote',
          '--single-process',
          '--disable-gpu',
        ],
      },
    });

    this.setupHandlers();
    this.registerWithGateway();
  }

  private registerWithGateway(): void {
    gateway.registerPlatform('whatsapp', async (response: NormalizedResponse) => {
      await this.sendResponse(response);
    });
  }

  private setupHandlers(): void {
    // QR code for first-time login
    this.client.on('qr', (qr) => {
      logger.info('WhatsApp QR code generated — scan with your phone:');
      qrcode.generate(qr, { small: true });
    });

    // Ready
    this.client.on('ready', async () => {
      this.isReady = true;
      logger.info('WhatsApp client ready');
      await this.sendStartupMessage();
    });

    // Authentication failure
    this.client.on('auth_failure', (msg) => {
      logger.error('WhatsApp authentication failed', { msg });
      this.isReady = false;
    });

    // Disconnected
    this.client.on('disconnected', (reason) => {
      logger.warn('WhatsApp disconnected', { reason });
      this.isReady = false;
    });

    // Incoming messages
    this.client.on('message', async (msg: Message) => {
      // Only process messages from authorized admins
      const senderNumber = msg.from;
      const adminNumbers = config.adminWhatsappNumbers.length > 0
        ? config.adminWhatsappNumbers
        : [config.adminWhatsappNumber];

      if (!adminNumbers.includes(senderNumber)) {
        await msg.reply('Unauthorized.');
        return;
      }

      // Skip status messages and broadcasts
      if (msg.isStatus || msg.broadcast) return;

      const text = msg.body.trim();
      if (!text) return;

      logger.debug(`WhatsApp message from ${senderNumber}: ${text.substring(0, 80)}`);

      // Check if this is a confirmation reply (yes/no)
      const pendingConfirmationId = pendingWhatsAppConfirmations.get(senderNumber);
      if (pendingConfirmationId) {
        const lower = text.toLowerCase();
        if (lower === 'yes' || lower === 'y') {
          pendingWhatsAppConfirmations.delete(senderNumber);
          await gateway.handleConfirmation(pendingConfirmationId, true);
          return;
        } else if (lower === 'no' || lower === 'n' || lower === 'cancel') {
          pendingWhatsAppConfirmations.delete(senderNumber);
          await gateway.handleConfirmation(pendingConfirmationId, false);
          return;
        }
      }

      const message: NormalizedMessage = {
        platform: 'whatsapp',
        userId: senderNumber,
        chatId: senderNumber,
        text,
        timestamp: new Date(msg.timestamp * 1000),
        messageId: msg.id.id,
      };

      await gateway.receiveMessage(message);
    });
  }

  private async sendResponse(response: NormalizedResponse): Promise<void> {
    if (!this.isReady) {
      logger.warn('WhatsApp client not ready, cannot send message');
      return;
    }

    try {
      const chatId = response.chatId;

      // If this is a confirmation request, track it and send plain text prompt
      if (response.confirmationId) {
        pendingWhatsAppConfirmations.set(chatId, response.confirmationId);

        // Strip markdown from confirmation message for WhatsApp
        const plainText = response.text
          .replace(/\*/g, '')
          .replace(/`/g, '')
          .replace(/_/g, '');

        await this.client.sendMessage(chatId, `${plainText}\n\nReply YES to confirm or NO to cancel.`);
        return;
      }

      // Strip markdown formatting for WhatsApp (plain text only)
      let text = response.text || '(empty response)';
      if (response.parseMode === 'Markdown') {
        text = text
          .replace(/\*\*(.*?)\*\*/g, '$1')
          .replace(/\*(.*?)\*/g, '$1')
          .replace(/`{3}[\s\S]*?`{3}/g, (match) => match.replace(/`{3}\w*\n?/g, ''))
          .replace(/`(.*?)`/g, '$1')
          .replace(/_{1,2}(.*?)_{1,2}/g, '$1')
          .replace(/\[(.*?)\]\(.*?\)/g, '$1');
      }

      // Split long messages (WhatsApp limit: ~65536 chars, but keep reasonable)
      const maxLength = 4000;
      if (text.length <= maxLength) {
        await this.client.sendMessage(chatId, text);
      } else {
        const chunks = this.splitMessage(text, maxLength);
        for (const chunk of chunks) {
          await this.client.sendMessage(chatId, chunk);
          // Small delay between chunks
          await new Promise((resolve) => setTimeout(resolve, 500));
        }
      }
    } catch (error: any) {
      logger.error('Failed to send WhatsApp message', { error: error.message });
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
    if (!this.isReady) return;

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
        `${config.agentName} Online\n\n` +
        `Time: ${new Date().toISOString()}\n` +
        `VPS: ${config.vpsHostname} | ${ips.join(', ') || 'unknown'}\n` +
        `AI Model: ${config.aiModel}\n` +
        `Platform: WhatsApp\n\n` +
        `Ready for commands. Send !help for available commands.`;

      await this.client.sendMessage(config.adminWhatsappNumber, message);
    } catch (error: any) {
      logger.warn('Failed to send WhatsApp startup message', { error: error.message });
    }
  }

  async start(): Promise<void> {
    logger.info('Starting WhatsApp client...');
    logger.info('If first run, scan the QR code below with your WhatsApp mobile app.');
    await this.client.initialize();
  }

  async stop(): Promise<void> {
    try {
      await this.client.destroy();
      logger.info('WhatsApp client stopped');
    } catch (error: any) {
      logger.warn('Error stopping WhatsApp client', { error: error.message });
    }
  }

  getClient(): Client {
    return this.client;
  }

  isClientReady(): boolean {
    return this.isReady;
  }
}

export const whatsAppPlatform = new WhatsAppPlatform();
export default whatsAppPlatform;
