import { EventEmitter } from 'events';
import {
  NormalizedMessage,
  NormalizedResponse,
  Platform,
  ConfirmationRequest,
} from './types';
import { logger } from '../logger';
import { config } from '../config';
import crypto from 'crypto';

export type MessageHandler = (message: NormalizedMessage) => Promise<NormalizedResponse[]>;
export type PlatformSender = (response: NormalizedResponse) => Promise<void>;
export type ConfirmationHandler = (confirmationId: string, confirmed: boolean) => Promise<void>;

export class Gateway extends EventEmitter {
  private messageHandler: MessageHandler | null = null;
  private platformSenders: Map<Platform, PlatformSender> = new Map();
  private pendingConfirmations: Map<string, ConfirmationRequest> = new Map();
  private rateLimitMap: Map<string, number[]> = new Map();

  constructor() {
    super();
  }

  setMessageHandler(handler: MessageHandler): void {
    this.messageHandler = handler;
  }

  registerPlatform(platform: Platform, sender: PlatformSender): void {
    this.platformSenders.set(platform, sender);
    logger.info(`Platform registered: ${platform}`);
  }

  async receiveMessage(message: NormalizedMessage): Promise<void> {
    if (!this.checkRateLimit(message.userId)) {
      logger.warn(`Rate limit exceeded for user ${message.userId}`);
      await this.sendResponse({
        platform: message.platform,
        chatId: message.chatId,
        text: '⚠️ Rate limit exceeded. Please wait before sending more messages.',
        parseMode: 'plain',
      });
      return;
    }

    if (!this.messageHandler) {
      logger.error('No message handler registered on Gateway');
      return;
    }

    try {
      logger.info(`Received message from ${message.platform}:${message.userId}: ${message.text.substring(0, 100)}`);
      const responses = await this.messageHandler(message);
      for (const response of responses) {
        await this.sendResponse(response);
      }
    } catch (error) {
      logger.error('Error processing message', { error });
      await this.sendResponse({
        platform: message.platform,
        chatId: message.chatId,
        text: `❌ An error occurred: ${error instanceof Error ? error.message : String(error)}`,
        parseMode: 'plain',
      });
    }
  }

  async sendResponse(response: NormalizedResponse): Promise<void> {
    const sender = this.platformSenders.get(response.platform);
    if (!sender) {
      logger.error(`No sender registered for platform: ${response.platform}`);
      return;
    }
    try {
      await sender(response);
    } catch (error) {
      logger.error(`Failed to send response on ${response.platform}`, { error });
    }
  }

  async requestConfirmation(
    platform: Platform,
    chatId: string,
    userId: string,
    command: string
  ): Promise<boolean> {
    return new Promise((resolve) => {
      const id = crypto.randomUUID();
      const expiresAt = new Date(Date.now() + 60_000); // 60 seconds

      const request: ConfirmationRequest = {
        id,
        platform,
        chatId,
        userId,
        command,
        expiresAt,
        resolve,
      };

      this.pendingConfirmations.set(id, request);

      // Auto-reject after 60 seconds
      setTimeout(() => {
        if (this.pendingConfirmations.has(id)) {
          this.pendingConfirmations.delete(id);
          resolve(false);
          this.sendResponse({
            platform,
            chatId,
            text: '⏱️ Confirmation timed out. Operation cancelled.',
            parseMode: 'plain',
          });
        }
      }, 60_000);

      // Send confirmation request to platform
      this.sendResponse({
        platform,
        chatId,
        text: `⚠️ *DESTRUCTIVE OPERATION DETECTED*\n\n\`${command}\`\n\nConfirm execution?`,
        parseMode: 'Markdown',
        confirmationId: id,
      });
    });
  }

  async handleConfirmation(confirmationId: string, confirmed: boolean): Promise<void> {
    const request = this.pendingConfirmations.get(confirmationId);
    if (!request) {
      logger.warn(`No pending confirmation found for id: ${confirmationId}`);
      return;
    }

    if (new Date() > request.expiresAt) {
      this.pendingConfirmations.delete(confirmationId);
      request.resolve(false);
      return;
    }

    this.pendingConfirmations.delete(confirmationId);
    request.resolve(confirmed);

    await this.sendResponse({
      platform: request.platform,
      chatId: request.chatId,
      text: confirmed ? '✅ Confirmed. Executing...' : '❌ Cancelled.',
      parseMode: 'plain',
    });
  }

  private checkRateLimit(userId: string): boolean {
    const now = Date.now();
    const windowMs = 60_000;
    const maxMessages = config.maxMessagesPerMinute;

    const timestamps = this.rateLimitMap.get(userId) || [];
    const recent = timestamps.filter((t) => now - t < windowMs);
    recent.push(now);
    this.rateLimitMap.set(userId, recent);

    return recent.length <= maxMessages;
  }

  getPendingConfirmation(id: string): ConfirmationRequest | undefined {
    return this.pendingConfirmations.get(id);
  }
}

export const gateway = new Gateway();
export default gateway;
