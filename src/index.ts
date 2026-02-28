import 'dotenv/config';
import { logger } from './logger';
import { config } from './config';
import { gateway } from './gateway/Gateway';
import { brain } from './brain/Brain';
import { memoryManager } from './memory/MemoryManager';
import { initConversationDB, getConversationDB } from './memory/ConversationDB';
import { toolRegistry } from './brain/ToolRegistry';
import { superclawConfig, isPlatformEnabled, getWhatsAppDriver } from './superclawConfig';
import { NormalizedMessage } from './gateway/types';
import { mcpManager } from './mcp/McpManager';

async function main(): Promise<void> {
  // Start web server if WEB_ENABLED=true (and not in WEB_ONLY mode)
  const webOnly = process.env['WEB_ONLY'] === 'true';
  const webEnabled = process.env['WEB_ENABLED'] === 'true' || webOnly;

  if (webEnabled) {
    try {
      const { startWebServer } = await import('./web/WebServer');
      const webPort = parseInt(process.env['WEB_PORT'] || '3000', 10);
      await startWebServer(webPort);
      logger.info(`Web admin panel started on port ${webPort}`);
    } catch (err: any) {
      logger.error('Failed to start web server', { error: err.message });
    }
  }

  // If WEB_ONLY mode, don't start the agent
  if (webOnly) {
    logger.info('WEB_ONLY mode — skipping agent startup');
    return;
  }

  logger.info(`Starting ${config.agentName}...`);

  // Initialize the database first — must complete before any platform or brain usage
  await initConversationDB();
  logger.info(`AI Provider: ${config.aiProvider} | Model: ${config.aiModel}`);
  logger.info(
    `Estimated RAM: ~${superclawConfig.estimatedRamMb} MB | ` +
    `Platforms: [${superclawConfig.platforms.join(', ')}] | ` +
    `WA Driver: ${superclawConfig.whatsappDriver}`
  );

  // Step 1: Ensure SOUL.md exists
  const soul = memoryManager.readSoul();
  if (!soul || soul.trim().length === 0) {
    logger.info('Generating SOUL.md...');
    const toolNames = toolRegistry.getToolNames();
    const soulContent = memoryManager.generateSoul(config.agentName, toolNames);
    memoryManager.writeSoul(soulContent);
    logger.info('SOUL.md generated');
  }

  // Step 2: Start MCP servers and register their tools
  try {
    await mcpManager.startAll();
    toolRegistry.registerMcpTools();
    logger.info('MCP servers initialized');
  } catch (e: any) {
    logger.warn(`MCP initialization error: ${e.message}`);
  }

  // Step 3: Wire Brain to Gateway
  gateway.setMessageHandler(async (message: NormalizedMessage) => {
    return brain.process(message);
  });

  logger.info(`Active tools: ${toolRegistry.getToolNames().join(', ')}`);

  const startupErrors: string[] = [];

  // Step 4a: Start Telegram (if enabled)
  if (isPlatformEnabled('telegram')) {
    try {
      const { telegramPlatform } = await import('./platforms/TelegramPlatform');
      await telegramPlatform.start();
      logger.info('Telegram platform started');
    } catch (error: any) {
      logger.error('Failed to start Telegram platform', { error: error.message });
      startupErrors.push(`Telegram: ${error.message}`);
    }
  } else {
    logger.info('Telegram platform disabled by config');
  }

  // Step 4b: Start WhatsApp (if enabled)
  if (isPlatformEnabled('whatsapp')) {
    const driver = getWhatsAppDriver();
    logger.info(`Starting WhatsApp with driver: ${driver}`);

    try {
      if (driver === 'baileys') {
        const { whatsAppBaileysPlatform } = await import('./platforms/WhatsAppBaileysPlatform');
        whatsAppBaileysPlatform.start().catch((error: any) => {
          logger.error('WhatsApp (Baileys) error', { error: error.message });
        });
        logger.info('WhatsApp (Baileys) initializing — check terminal for QR code if first run');
      } else {
        const { whatsAppPlatform } = await import('./platforms/WhatsAppPlatform');
        whatsAppPlatform.start().catch((error: any) => {
          logger.error('WhatsApp (Puppeteer) error', { error: error.message });
        });
        logger.info('WhatsApp (Puppeteer) initializing — check terminal for QR code if first run');
      }
    } catch (error: any) {
      logger.error('Failed to start WhatsApp platform', { error: error.message });
      startupErrors.push(`WhatsApp: ${error.message}`);
    }
  } else {
    logger.info('WhatsApp platform disabled by config');
  }

  if (startupErrors.length > 0) {
    logger.warn(`Started with errors: ${startupErrors.join('; ')}`);
  } else {
    logger.info(`${config.agentName} fully started and ready`);
  }

  // Step 5: Graceful shutdown
  const shutdown = async (signal: string): Promise<void> => {
    logger.info(`Received ${signal}, shutting down gracefully...`);

    if (isPlatformEnabled('telegram')) {
      try {
        const { telegramPlatform } = await import('./platforms/TelegramPlatform');
        await telegramPlatform.stop();
      } catch (error: any) {
        logger.warn('Error stopping Telegram', { error: error.message });
      }
    }

    if (isPlatformEnabled('whatsapp')) {
      try {
        if (getWhatsAppDriver() === 'baileys') {
          const { whatsAppBaileysPlatform } = await import('./platforms/WhatsAppBaileysPlatform');
          await whatsAppBaileysPlatform.stop();
        } else {
          const { whatsAppPlatform } = await import('./platforms/WhatsAppPlatform');
          await whatsAppPlatform.stop();
        }
      } catch (error: any) {
        logger.warn('Error stopping WhatsApp', { error: error.message });
      }
    }

    try {
      getConversationDB().close();
    } catch (error: any) {
      logger.warn('Error closing DB', { error: error.message });
    }

    logger.info(`${config.agentName} shut down cleanly`);
    process.exit(0);
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('uncaughtException', (error) => {
    logger.error('Uncaught exception', { error: error.message, stack: error.stack });
  });
  process.on('unhandledRejection', (reason) => {
    logger.error('Unhandled rejection', { reason });
  });
}

main().catch((error) => {
  console.error('Fatal startup error:', error);
  process.exit(1);
});
