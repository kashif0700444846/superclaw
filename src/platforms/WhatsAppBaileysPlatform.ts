/* eslint-disable @typescript-eslint/no-var-requires */
/**
 * WhatsApp platform using @whiskeysockets/baileys (pure WebSocket, no Chromium).
 * Packages are loaded via require() so TypeScript compiles even before npm install.
 * Run: npm install  (or pnpm install) to pull in @whiskeysockets/baileys, @hapi/boom, pino.
 */

import qrcode from 'qrcode-terminal';
import path from 'path';
import fs from 'fs';
import { NormalizedMessage, NormalizedResponse } from '../gateway/types';
import { gateway } from '../gateway/Gateway';
import { config } from '../config';
import { logger } from '../logger';

// Track pending confirmations waiting for WhatsApp reply: jid -> confirmationId
const pendingConfirmations = new Map<string, string>();

// Normalize any phone number string to Baileys JID format (@s.whatsapp.net)
function toJid(number: string): string {
  const clean = number.replace(/@.*$/, '').replace(/[^0-9]/g, '');
  return `${clean}@s.whatsapp.net`;
}

export class WhatsAppBaileysPlatform {
  private sock: any = null;
  private isReady: boolean = false;
  private sessionPath: string;
  private shouldReconnect: boolean = true;

  constructor() {
    this.sessionPath = path.resolve(process.cwd(), 'whatsapp-session-baileys');
    if (!fs.existsSync(this.sessionPath)) {
      fs.mkdirSync(this.sessionPath, { recursive: true });
    }
    this.registerWithGateway();
  }

  private registerWithGateway(): void {
    gateway.registerPlatform('whatsapp', async (response: NormalizedResponse) => {
      await this.sendResponse(response);
    });
  }

  private async connect(): Promise<void> {
    logger.info('Starting WhatsApp (Baileys) client...');

    // Dynamic require — packages must be installed via npm install
    let makeWASocket: any;
    let useMultiFileAuthState: any;
    let DisconnectReason: any;
    let fetchLatestBaileysVersion: any;
    let makeCacheableSignalKeyStore: any;
    let Boom: any;
    let pino: any;

    try {
      const baileys = require('@whiskeysockets/baileys');
      makeWASocket = baileys.default || baileys;
      useMultiFileAuthState = baileys.useMultiFileAuthState;
      DisconnectReason = baileys.DisconnectReason;
      fetchLatestBaileysVersion = baileys.fetchLatestBaileysVersion;
      makeCacheableSignalKeyStore = baileys.makeCacheableSignalKeyStore;
      Boom = require('@hapi/boom').Boom;
      pino = require('pino');
    } catch (e: any) {
      logger.error(
        'Failed to load @whiskeysockets/baileys — run: npm install @whiskeysockets/baileys @hapi/boom pino',
        { error: e.message }
      );
      throw e;
    }

    const { state, saveCreds } = await useMultiFileAuthState(this.sessionPath);
    const { version } = await fetchLatestBaileysVersion();

    this.sock = makeWASocket({
      version,
      auth: {
        creds: state.creds,
        keys: makeCacheableSignalKeyStore(state.keys, pino({ level: 'silent' })),
      },
      printQRInTerminal: false, // We handle QR ourselves
      logger: pino({ level: 'silent' }),
      browser: ['SuperClaw', 'Chrome', '120.0.0'],
    });

    // Save credentials on update
    this.sock.ev.on('creds.update', saveCreds);

    // Connection updates
    this.sock.ev.on('connection.update', async (update: any) => {
      const { connection, lastDisconnect, qr } = update;

      if (qr) {
        logger.info('WhatsApp QR code — scan with your phone:');
        qrcode.generate(qr, { small: true });
      }

      if (connection === 'open') {
        this.isReady = true;
        logger.info('WhatsApp (Baileys) connected successfully');
        await this.sendStartupMessage();
      }

      if (connection === 'close') {
        this.isReady = false;
        const statusCode = (lastDisconnect?.error as any)?.output?.statusCode;
        const loggedOut = statusCode === DisconnectReason.loggedOut;

        logger.warn(`WhatsApp connection closed. Status: ${statusCode}. LoggedOut: ${loggedOut}`);

        if (!loggedOut && this.shouldReconnect) {
          logger.info('Reconnecting WhatsApp (Baileys) in 5s...');
          setTimeout(() => this.connect(), 5000);
        } else if (loggedOut) {
          logger.error(
            'WhatsApp logged out — delete the whatsapp-session-baileys/ folder and restart to re-authenticate'
          );
        }
      }
    });

    // Incoming messages
    this.sock.ev.on('messages.upsert', async ({ messages, type }: { messages: any[]; type: string }) => {
      if (type !== 'notify') return;

      for (const msg of messages) {
        if (!msg.message) continue;
        if (msg.key.fromMe) continue; // Skip our own messages

        const from: string = msg.key.remoteJid || '';

        // Auth check — support multiple admin numbers.
        // Build effective admin list: prefer the parsed array, fall back to legacy single string.
        const effectiveAdminNumbers = config.adminWhatsappNumbers.length > 0
          ? config.adminWhatsappNumbers
          : [config.adminWhatsappNumber];
        const adminJids = effectiveAdminNumbers
          .map((n) => n.replace(/\r/g, '').trim())
          .filter((n) => n.length > 0 && n !== 'DISABLED')
          .map(toJid);

        console.log(`[Auth] WhatsApp message from ${from}, adminJids=[${adminJids.join(', ')}], authorized=${adminJids.includes(from)}`);

        if (adminJids.length === 0 || !adminJids.includes(from)) {
          await this.sock?.sendMessage(from, { text: 'Unauthorized.' });
          continue;
        }

        // Extract text from various message types
        const text = (
          msg.message.conversation ||
          msg.message.extendedTextMessage?.text ||
          ''
        ).trim();

        if (!text) continue;

        logger.debug(`WhatsApp (Baileys) message from ${from}: ${text.substring(0, 80)}`);

        // Check for pending confirmation reply
        const pendingConfirmationId = pendingConfirmations.get(from);
        if (pendingConfirmationId) {
          const lower = text.toLowerCase();
          if (lower === 'yes' || lower === 'y') {
            pendingConfirmations.delete(from);
            await gateway.handleConfirmation(pendingConfirmationId, true);
            continue;
          } else if (lower === 'no' || lower === 'n' || lower === 'cancel') {
            pendingConfirmations.delete(from);
            await gateway.handleConfirmation(pendingConfirmationId, false);
            continue;
          }
        }

        const normalizedMsg: NormalizedMessage = {
          platform: 'whatsapp',
          userId: from,
          chatId: from,
          text,
          timestamp: new Date((msg.messageTimestamp as number) * 1000),
          messageId: msg.key.id || undefined,
        };

        await gateway.receiveMessage(normalizedMsg);
      }
    });
  }

  private async sendResponse(response: NormalizedResponse): Promise<void> {
    if (!this.isReady || !this.sock) {
      logger.warn('WhatsApp (Baileys) not ready, cannot send message');
      return;
    }

    try {
      const jid = response.chatId.includes('@')
        ? response.chatId
        : toJid(response.chatId);

      if (response.confirmationId) {
        pendingConfirmations.set(jid, response.confirmationId);
        const plainText = response.text
          .replace(/\*/g, '')
          .replace(/`/g, '')
          .replace(/_/g, '');
        await this.sock.sendMessage(jid, {
          text: `${plainText}\n\nReply YES to confirm or NO to cancel.`,
        });
        return;
      }

      let text = response.text || '(empty response)';

      // Strip markdown for WhatsApp plain text
      if (response.parseMode === 'Markdown') {
        text = text
          .replace(/\*\*(.*?)\*\*/g, '$1')
          .replace(/\*(.*?)\*/g, '$1')
          .replace(/`{3}[\s\S]*?`{3}/g, (match: string) => match.replace(/`{3}\w*\n?/g, ''))
          .replace(/`(.*?)`/g, '$1')
          .replace(/_{1,2}(.*?)_{1,2}/g, '$1')
          .replace(/\[(.*?)\]\(.*?\)/g, '$1');
      }

      const maxLength = 4000;
      const chunks = this.splitMessage(text, maxLength);
      for (const chunk of chunks) {
        await this.sock.sendMessage(jid, { text: chunk });
        if (chunks.length > 1) await new Promise((r) => setTimeout(r, 500));
      }
    } catch (error: any) {
      logger.error('Failed to send WhatsApp (Baileys) message', { error: error.message });
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
      if (splitAt === -1 || splitAt < maxLength / 2) splitAt = maxLength;
      chunks.push(remaining.substring(0, splitAt));
      remaining = remaining.substring(splitAt).trimStart();
    }
    return chunks;
  }

  async sendStartupMessage(): Promise<void> {
    if (!this.isReady || !this.sock) return;
    try {
      const os = await import('os');
      const interfaces = os.networkInterfaces();
      const ips: string[] = [];
      for (const [, addrs] of Object.entries(interfaces)) {
        for (const addr of addrs || []) {
          if (!addr.internal && addr.family === 'IPv4') ips.push(addr.address);
        }
      }
      const message =
        `${config.agentName} Online (Baileys — lightweight mode)\n\n` +
        `Time: ${new Date().toISOString()}\n` +
        `VPS: ${config.vpsHostname} | ${ips.join(', ') || 'unknown'}\n` +
        `AI Model: ${config.aiModel}\n` +
        `Platform: WhatsApp (Baileys, no Chromium)\n\n` +
        `Ready for commands. Send !help for available commands.`;

      // Send to all configured admin numbers
      const effectiveAdminNumbers = config.adminWhatsappNumbers.length > 0
        ? config.adminWhatsappNumbers
        : [config.adminWhatsappNumber];
      for (const num of effectiveAdminNumbers) {
        const cleaned = num.replace(/\r/g, '').trim();
        if (!cleaned || cleaned === 'DISABLED') continue;
        await this.sock.sendMessage(toJid(cleaned), { text: message });
      }
    } catch (error: any) {
      logger.warn('Failed to send WhatsApp startup message', { error: error.message });
    }
  }

  async start(): Promise<void> {
    logger.info('Starting WhatsApp (Baileys) — lightweight mode, no Chromium required...');
    this.shouldReconnect = true;
    await this.connect();
  }

  async stop(): Promise<void> {
    this.shouldReconnect = false;
    this.isReady = false;
    try {
      if (this.sock) {
        this.sock.end(undefined);
        this.sock = null;
      }
      logger.info('WhatsApp (Baileys) stopped');
    } catch (error: any) {
      logger.warn('Error stopping WhatsApp (Baileys)', { error: error.message });
    }
  }

  isClientReady(): boolean {
    return this.isReady;
  }
}

export const whatsAppBaileysPlatform = new WhatsAppBaileysPlatform();
export default whatsAppBaileysPlatform;
