# SuperClaw — Modular Memory-Efficient Architecture Specification

**Version:** 1.0  
**Status:** Ready for Implementation  
**Target Mode:** Code

---

## Table of Contents

1. [Executive Summary](#1-executive-summary)
2. [WhatsApp Library Recommendation — Baileys](#2-whatsapp-library-recommendation--baileys)
3. [superclaw.config.json Schema](#3-superclawconfigjson-schema)
4. [Memory Footprint Tiers](#4-memory-footprint-tiers)
5. [Wizard UX Flow](#5-wizard-ux-flow)
6. [Conditional Platform Loading — src/index.ts](#6-conditional-platform-loading--srcindexts)
7. [New WhatsAppBaileysPlatform Implementation](#7-new-whatsappbaileyspaltform-implementation)
8. [ToolRegistry Conditional Loading](#8-toolregistry-conditional-loading)
9. [config.ts Changes](#9-configts-changes)
10. [package.json Changes](#10-packagejson-changes)
11. [File Change Summary](#11-file-change-summary)
12. [Memory Comparison vs OpenClaw](#12-memory-comparison-vs-openclaw)

---

## 1. Executive Summary

SuperClaw currently hard-imports `whatsapp-web.js` + `puppeteer` at startup, unconditionally loading ~400–500 MB of Chromium even when WhatsApp is not needed. The upgrade replaces this with:

1. A **`superclaw.config.json`** file (written by the setup wizard) that declares which platforms and tools are active.
2. **Dynamic `import()`** in `src/index.ts` so only selected platform modules are loaded at runtime.
3. **`@whiskeysockets/baileys`** as the default WhatsApp driver (pure WebSocket, no browser, ~20–50 MB).
4. **Puppeteer/whatsapp-web.js** retained as an optional "compatibility" driver for users who need it.
5. **Conditional tool registration** in `ToolRegistry` so optional tools (web_search, code_executor) are only loaded when their dependencies are present.

The result is a **Telegram-only Ultra-Lite mode at ~80–120 MB RAM** and a **Standard mode (Telegram + WhatsApp via Baileys) at ~150–200 MB RAM**.

---

## 2. WhatsApp Library Recommendation — Baileys

### Decision: `@whiskeysockets/baileys`

| Criterion | @whiskeysockets/baileys | whatsapp-web.js |
|-----------|------------------------|-----------------|
| Transport | Pure WebSocket (WA Multi-Device API) | Puppeteer + Chromium |
| RAM overhead | ~20–50 MB | ~300–500 MB |
| Storage overhead | ~5 MB (node_modules) | ~350 MB (Chromium binary) |
| Node.js/TS support | Native TypeScript, full types | JS with @types |
| Session persistence | JSON file or custom store | LocalAuth (Chromium profile) |
| QR code login | Yes (terminal + buffer) | Yes (terminal) |
| Active maintenance | Yes (community fork, 2024 active) | Yes |
| Multi-device support | Yes (WA MD protocol) | Yes |
| Sends text messages | Yes | Yes |
| Receives text messages | Yes | Yes |

**Justification:** Baileys communicates directly with WhatsApp's Multi-Device WebSocket API — no browser process is spawned. The entire library is ~5 MB of JavaScript. Session state is stored as a JSON file (or in-memory). This is the same approach used by production WhatsApp bots at scale (e.g., WhatsApp Business API proxies). The `@whiskeysockets/baileys` fork is the most actively maintained as of 2024–2026.

### Baileys TypeScript Integration Notes

```typescript
// Install
// npm install @whiskeysockets/baileys
// npm install @hapi/boom pino  (peer deps)

import makeWASocket, {
  DisconnectReason,
  useMultiFileAuthState,
  fetchLatestBaileysVersion,
  makeCacheableSignalKeyStore,
  proto,
  WASocket,
} from '@whiskeysockets/baileys';
import { Boom } from '@hapi/boom';
import pino from 'pino';
```

**Session persistence** uses `useMultiFileAuthState(folder)` which writes auth credentials to a directory (e.g., `./whatsapp-baileys-session/`). This replaces `LocalAuth` from whatsapp-web.js.

**QR code** is emitted as a string via the `connection.update` event when `qr` is present — pass it to `qrcode-terminal` exactly as before.

**Message sending:**
```typescript
await sock.sendMessage(jid, { text: 'Hello' });
// jid format: "15551234567@s.whatsapp.net"  (not @c.us)
```

**Message receiving:**
```typescript
sock.ev.on('messages.upsert', ({ messages, type }) => {
  if (type !== 'notify') return;
  for (const msg of messages) {
    const text = msg.message?.conversation
      || msg.message?.extendedTextMessage?.text
      || '';
    const from = msg.key.remoteJid!;
    // process...
  }
});
```

**JID format difference:** Baileys uses `@s.whatsapp.net` for individual chats (vs `@c.us` in whatsapp-web.js). The wizard must store the number in the new format, or normalize on read.

**Reconnection:** Baileys emits `connection.update` with `lastDisconnect`. Reconnect logic:
```typescript
sock.ev.on('connection.update', ({ connection, lastDisconnect, qr }) => {
  if (connection === 'close') {
    const shouldReconnect =
      (lastDisconnect?.error as Boom)?.output?.statusCode !== DisconnectReason.loggedOut;
    if (shouldReconnect) reconnect();
  }
});
```

---

## 3. superclaw.config.json Schema

**Location:** `./superclaw.config.json` (project root, next to `.env`)

**Written by:** the setup wizard at the end of Step 4.  
**Read by:** `src/index.ts` at startup before any platform imports.

### Full Schema

```typescript
// src/types/SuperclawConfig.ts  (NEW FILE)

export type WhatsAppDriver = 'baileys' | 'puppeteer';
export type PlatformName = 'telegram' | 'whatsapp';
export type ToolName =
  | 'shell'
  | 'file_read'
  | 'file_write'
  | 'file_list'
  | 'http'
  | 'packages'
  | 'services'
  | 'cron'
  | 'processes'
  | 'system'
  | 'memory_read'
  | 'memory_write'
  | 'ai_query'
  | 'web_search'
  | 'code_executor';

export interface SuperclawConfig {
  /** Schema version for future migrations */
  schemaVersion: 1;

  /** Which messaging platforms to load */
  platforms: PlatformName[];

  /** Which WhatsApp driver to use (only relevant if 'whatsapp' in platforms) */
  whatsappDriver: WhatsAppDriver;

  /** Tools explicitly enabled */
  enabledTools: ToolName[];

  /** Tools explicitly disabled (takes precedence over enabledTools) */
  disabledTools: ToolName[];

  /** Estimated RAM tier for display purposes */
  estimatedRamMb: number;

  /** Timestamp when config was generated */
  generatedAt: string;
}
```

### Example: Ultra-Lite (Telegram only)

```json
{
  "schemaVersion": 1,
  "platforms": ["telegram"],
  "whatsappDriver": "baileys",
  "enabledTools": [
    "shell", "file_read", "file_write", "file_list",
    "http", "packages", "services", "cron",
    "processes", "system", "memory_read", "memory_write", "ai_query"
  ],
  "disabledTools": ["web_search", "code_executor"],
  "estimatedRamMb": 100,
  "generatedAt": "2026-02-27T18:00:00.000Z"
}
```

### Example: Standard (Telegram + WhatsApp via Baileys)

```json
{
  "schemaVersion": 1,
  "platforms": ["telegram", "whatsapp"],
  "whatsappDriver": "baileys",
  "enabledTools": [
    "shell", "file_read", "file_write", "file_list",
    "http", "packages", "services", "cron",
    "processes", "system", "memory_read", "memory_write", "ai_query"
  ],
  "disabledTools": ["web_search", "code_executor"],
  "estimatedRamMb": 175,
  "generatedAt": "2026-02-27T18:00:00.000Z"
}
```

### Example: Full (Telegram + WhatsApp via Puppeteer, all tools)

```json
{
  "schemaVersion": 1,
  "platforms": ["telegram", "whatsapp"],
  "whatsappDriver": "puppeteer",
  "enabledTools": [
    "shell", "file_read", "file_write", "file_list",
    "http", "packages", "services", "cron",
    "processes", "system", "memory_read", "memory_write",
    "ai_query", "web_search", "code_executor"
  ],
  "disabledTools": [],
  "estimatedRamMb": 650,
  "generatedAt": "2026-02-27T18:00:00.000Z"
}
```

### Config Loader Utility

```typescript
// src/superclawConfig.ts  (NEW FILE)

import fs from 'fs';
import path from 'path';
import { SuperclawConfig } from './types/SuperclawConfig';

const CONFIG_PATH = path.resolve(process.cwd(), 'superclaw.config.json');

const DEFAULT_CONFIG: SuperclawConfig = {
  schemaVersion: 1,
  platforms: ['telegram', 'whatsapp'],
  whatsappDriver: 'baileys',
  enabledTools: [
    'shell', 'file_read', 'file_write', 'file_list',
    'http', 'packages', 'services', 'cron',
    'processes', 'system', 'memory_read', 'memory_write', 'ai_query',
  ],
  disabledTools: [],
  estimatedRamMb: 175,
  generatedAt: new Date().toISOString(),
};

export function loadSuperclawConfig(): SuperclawConfig {
  if (!fs.existsSync(CONFIG_PATH)) {
    return DEFAULT_CONFIG;
  }
  try {
    const raw = fs.readFileSync(CONFIG_PATH, 'utf-8');
    return JSON.parse(raw) as SuperclawConfig;
  } catch {
    return DEFAULT_CONFIG;
  }
}

export function isToolEnabled(config: SuperclawConfig, toolName: string): boolean {
  if (config.disabledTools.includes(toolName as any)) return false;
  return config.enabledTools.includes(toolName as any);
}

export function isPlatformEnabled(config: SuperclawConfig, platform: string): boolean {
  return config.platforms.includes(platform as any);
}
```

---

## 4. Memory Footprint Tiers

### RAM Breakdown by Component

| Component | RAM Usage | Notes |
|-----------|-----------|-------|
| Node.js runtime | ~30–40 MB | Always present |
| grammy (Telegram) | ~10–15 MB | Always if Telegram enabled |
| better-sqlite3 | ~5–10 MB | Always (conversation DB) |
| winston logger | ~5 MB | Always |
| openai/anthropic SDK | ~10–15 MB | Always (AI provider) |
| Core tools (13 tools) | ~5–10 MB | Always |
| @whiskeysockets/baileys | ~20–50 MB | Only if WhatsApp + Baileys |
| whatsapp-web.js | ~50–80 MB | Only if WhatsApp + Puppeteer |
| Chromium (Puppeteer) | ~300–450 MB | Only if WhatsApp + Puppeteer |
| web_search tool | ~2 MB | Optional |
| code_executor tool | ~2 MB | Optional |

### Memory Tiers Table

| Mode | Platforms | WA Driver | Tools | Target RAM | Target Storage |
|------|-----------|-----------|-------|------------|----------------|
| Ultra-Lite | Telegram only | N/A | Core 13 | ~80–120 MB | ~500 MB |
| Standard | Telegram + WhatsApp | Baileys | Core 13 | ~150–200 MB | ~600 MB |
| Standard+ | Telegram + WhatsApp | Baileys | All 15 | ~155–210 MB | ~610 MB |
| Full | Telegram + WhatsApp | Puppeteer | All 15 | ~500–800 MB | ~1.5 GB |

### Storage Breakdown

| Component | Storage | Notes |
|-----------|---------|-------|
| Node.js | ~80 MB | System install |
| node_modules (core) | ~150 MB | grammy, openai, sqlite, etc. |
| @whiskeysockets/baileys | ~15 MB | Baileys + peer deps |
| whatsapp-web.js | ~30 MB | JS library only |
| Chromium binary | ~350 MB | Only with puppeteer |
| TypeScript compiled output | ~5 MB | dist/ |
| Session data | ~1–5 MB | Auth credentials |

---

## 5. Wizard UX Flow

The existing `src/setup/wizard.ts` must be extended with 4 new steps inserted **after** the existing AI provider and Telegram steps, and **before** the final summary. The wizard writes both `.env` and `superclaw.config.json`.

### Step-by-Step Flow

```
╔══════════════════════════════════════╗
║       SuperClaw Setup Wizard         ║
║   Autonomous AI Agent Configuration  ║
╚══════════════════════════════════════╝

[Existing steps: AI Provider, API Keys, Telegram Token, Admin ID]

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
STEP A: Platform Selection
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
? Which platforms do you want to enable?
  ❯ ◉ Telegram only          (~80–120 MB RAM, ~500 MB storage)
    ◯ Telegram + WhatsApp    (~150–200 MB RAM, ~600 MB storage)

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
STEP B: WhatsApp Driver  [shown only if WhatsApp selected]
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
? Which WhatsApp driver do you want to use?
  ❯ Baileys — Lightweight WebSocket  (~30 MB, RECOMMENDED)
    Puppeteer — Browser-based        (~400 MB, maximum compatibility)

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
STEP C: WhatsApp Credentials  [shown only if WhatsApp selected]
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
? WhatsApp session name: (superclaw)
? Your WhatsApp number (e.g. 15551234567):
  [Note: Baileys uses @s.whatsapp.net format — wizard normalizes automatically]

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
STEP D: Optional Tools
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
? Which optional tools do you want to enable?
  (Core tools are always included: shell, file, http, packages,
   services, cron, processes, system, memory, ai_query)

  ◯ web_search   — Requires SerpAPI key  (+2 MB RAM)
  ◯ code_executor — Python/Node sandbox  (+2 MB RAM)

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
STEP E: SerpAPI Key  [shown only if web_search selected]
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
? SerpAPI key (from serpapi.com):

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
STEP F: Final Footprint Summary
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
╔══════════════════════════════════════╗
║        Estimated Footprint           ║
╠══════════════════════════════════════╣
║  Mode:     Standard                  ║
║  RAM:      ~150–200 MB               ║
║  Storage:  ~600 MB                   ║
║  Platforms: Telegram, WhatsApp       ║
║  WA Driver: Baileys (lightweight)    ║
║  Tools:    13 core + 0 optional      ║
╚══════════════════════════════════════╝

? Confirm and write configuration? (Y/n)
```

### RAM Estimate Calculation Logic (in wizard)

```typescript
function calculateRamEstimate(
  platforms: string[],
  whatsappDriver: string,
  enabledTools: string[]
): { min: number; max: number } {
  let min = 65;  // Node.js + core libs baseline
  let max = 90;

  if (platforms.includes('telegram')) {
    min += 10; max += 15;  // grammy
  }
  if (platforms.includes('whatsapp')) {
    if (whatsappDriver === 'baileys') {
      min += 20; max += 50;  // Baileys WebSocket
    } else {
      min += 350; max += 500; // Puppeteer + Chromium
    }
  }
  if (enabledTools.includes('web_search')) {
    min += 2; max += 3;
  }
  if (enabledTools.includes('code_executor')) {
    min += 2; max += 3;
  }

  return { min, max };
}
```

### Wizard Output Files

After confirmation, the wizard writes:
1. **`.env`** — same as today, but `ADMIN_WHATSAPP_NUMBER` stores the raw number (e.g., `15551234567`); the platform normalizes to the correct JID format.
2. **`superclaw.config.json`** — the new config file at project root.

```typescript
function writeSuperclaWConfig(answers: WizardAnswers): void {
  const config: SuperclawConfig = {
    schemaVersion: 1,
    platforms: answers.platforms,
    whatsappDriver: answers.whatsappDriver,
    enabledTools: [
      'shell', 'file_read', 'file_write', 'file_list',
      'http', 'packages', 'services', 'cron',
      'processes', 'system', 'memory_read', 'memory_write', 'ai_query',
      ...answers.optionalTools,
    ],
    disabledTools: ALL_OPTIONAL_TOOLS.filter(t => !answers.optionalTools.includes(t)),
    estimatedRamMb: calculateRamEstimate(
      answers.platforms,
      answers.whatsappDriver,
      answers.optionalTools
    ).min,
    generatedAt: new Date().toISOString(),
  };

  fs.writeFileSync(
    path.resolve(process.cwd(), 'superclaw.config.json'),
    JSON.stringify(config, null, 2)
  );
  console.log(chalk.green('✅ superclaw.config.json written'));
}
```

---

## 6. Conditional Platform Loading — src/index.ts

The current `src/index.ts` statically imports both platforms at the top of the file. This must change to **dynamic `import()`** gated on the config.

### New src/index.ts Structure

```typescript
import 'dotenv/config';
import { logger } from './logger';
import { config } from './config';
import { gateway } from './gateway/Gateway';
import { brain } from './brain/Brain';
import { memoryManager } from './memory/MemoryManager';
import { conversationDB } from './memory/ConversationDB';
import { toolRegistry } from './brain/ToolRegistry';
import { NormalizedMessage } from './gateway/types';
import { loadSuperclawConfig, isPlatformEnabled } from './superclawConfig';

async function main(): Promise<void> {
  // Load modular config FIRST — before any platform imports
  const superclawConfig = loadSuperclawConfig();

  logger.info(`Starting ${config.agentName}...`);
  logger.info(`Mode: platforms=[${superclawConfig.platforms.join(',')}] driver=${superclawConfig.whatsappDriver} ram~${superclawConfig.estimatedRamMb}MB`);
  logger.info(`AI Provider: ${config.aiProvider} | Model: ${config.aiModel}`);

  // Step 1: Ensure memory files exist
  const soul = memoryManager.readSoul();
  if (!soul || soul.trim().length === 0) {
    logger.info('Generating SOUL.md...');
    const toolNames = toolRegistry.getToolNames();
    const soulContent = memoryManager.generateSoul(config.agentName, toolNames);
    memoryManager.writeSoul(soulContent);
    logger.info('SOUL.md generated');
  }

  // Step 2: Wire Brain to Gateway
  gateway.setMessageHandler(async (message: NormalizedMessage) => {
    return brain.process(message);
  });

  logger.info(`Tools registered: ${toolRegistry.getToolNames().join(', ')}`);

  // Step 3: Conditionally start platforms
  const startupErrors: string[] = [];

  // --- Telegram (always load if in platforms list) ---
  if (isPlatformEnabled(superclawConfig, 'telegram')) {
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

  // --- WhatsApp (conditional on platform + driver) ---
  if (isPlatformEnabled(superclawConfig, 'whatsapp')) {
    if (superclawConfig.whatsappDriver === 'baileys') {
      try {
        const { whatsAppBaileysPlatform } = await import('./platforms/WhatsAppBaileysPlatform');
        whatsAppBaileysPlatform.start().catch((error: any) => {
          logger.error('WhatsApp Baileys error', { error: error.message });
        });
        logger.info('WhatsApp (Baileys) platform initializing — scan QR if first run');
      } catch (error: any) {
        logger.error('Failed to start WhatsApp Baileys platform', { error: error.message });
        startupErrors.push(`WhatsApp(Baileys): ${error.message}`);
      }
    } else {
      // puppeteer driver — legacy whatsapp-web.js
      try {
        const { whatsAppPlatform } = await import('./platforms/WhatsAppPlatform');
        whatsAppPlatform.start().catch((error: any) => {
          logger.error('WhatsApp Puppeteer error', { error: error.message });
        });
        logger.info('WhatsApp (Puppeteer) platform initializing — scan QR if first run');
      } catch (error: any) {
        logger.error('Failed to start WhatsApp Puppeteer platform', { error: error.message });
        startupErrors.push(`WhatsApp(Puppeteer): ${error.message}`);
      }
    }
  } else {
    logger.info('WhatsApp platform disabled by config');
  }

  if (startupErrors.length > 0) {
    logger.warn(`Started with errors: ${startupErrors.join('; ')}`);
  } else {
    logger.info(`${config.agentName} fully started and ready`);
  }

  // Step 4: Graceful shutdown
  const shutdown = async (signal: string): Promise<void> => {
    logger.info(`Received ${signal}, shutting down gracefully...`);

    if (isPlatformEnabled(superclawConfig, 'telegram')) {
      try {
        const { telegramPlatform } = await import('./platforms/TelegramPlatform');
        await telegramPlatform.stop();
      } catch (error: any) {
        logger.warn('Error stopping Telegram', { error: error.message });
      }
    }

    if (isPlatformEnabled(superclawConfig, 'whatsapp')) {
      if (superclawConfig.whatsappDriver === 'baileys') {
        try {
          const { whatsAppBaileysPlatform } = await import('./platforms/WhatsAppBaileysPlatform');
          await whatsAppBaileysPlatform.stop();
        } catch (error: any) {
          logger.warn('Error stopping WhatsApp Baileys', { error: error.message });
        }
      } else {
        try {
          const { whatsAppPlatform } = await import('./platforms/WhatsAppPlatform');
          await whatsAppPlatform.stop();
        } catch (error: any) {
          logger.warn('Error stopping WhatsApp Puppeteer', { error: error.message });
        }
      }
    }

    try {
      conversationDB.close();
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
```

**Key change:** The `import` statements for `TelegramPlatform`, `WhatsAppPlatform`, and the new `WhatsAppBaileysPlatform` are moved from static top-level imports to `await import(...)` calls inside `if` blocks. Node.js will not load (or execute) those modules unless the `import()` is reached.

---

## 7. New WhatsAppBaileysPlatform Implementation

**File:** `src/platforms/WhatsAppBaileysPlatform.ts` (NEW FILE)

This replaces `WhatsAppPlatform.ts` for the Baileys driver. The existing `WhatsAppPlatform.ts` is kept unchanged for the Puppeteer path.

```typescript
// src/platforms/WhatsAppBaileysPlatform.ts

import makeWASocket, {
  DisconnectReason,
  useMultiFileAuthState,
  fetchLatestBaileysVersion,
  proto,
  WASocket,
  BaileysEventMap,
} from '@whiskeysockets/baileys';
import { Boom } from '@hapi/boom';
import pino from 'pino';
import qrcode from 'qrcode-terminal';
import path from 'path';
import { NormalizedMessage, NormalizedResponse } from '../gateway/types';
import { gateway } from '../gateway/Gateway';
import { config } from '../config';
import { logger } from '../logger';

// Pending confirmations: jid -> confirmationId
const pendingConfirmations = new Map<string, string>();

// Normalize phone number to Baileys JID format
function toJid(number: string): string {
  // Strip any existing suffix, then add @s.whatsapp.net
  const clean = number.replace(/@.*$/, '').replace(/[^0-9]/g, '');
  return `${clean}@s.whatsapp.net`;
}

export class WhatsAppBaileysPlatform {
  private sock: WASocket | null = null;
  private isReady: boolean = false;
  private sessionPath: string;
  private shouldReconnect: boolean = true;

  constructor() {
    this.sessionPath = path.resolve(process.cwd(), 'whatsapp-baileys-session');
    this.registerWithGateway();
  }

  private registerWithGateway(): void {
    gateway.registerPlatform('whatsapp', async (response: NormalizedResponse) => {
      await this.sendResponse(response);
    });
  }

  async start(): Promise<void> {
    this.shouldReconnect = true;
    await this.connect();
  }

  private async connect(): Promise<void> {
    logger.info('Starting WhatsApp (Baileys) client...');

    const { state, saveCreds } = await useMultiFileAuthState(this.sessionPath);
    const { version } = await fetchLatestBaileysVersion();

    this.sock = makeWASocket({
      version,
      auth: state,
      logger: pino({ level: 'silent' }),  // suppress Baileys internal logs
      printQRInTerminal: false,            // we handle QR ourselves
      browser: ['SuperClaw', 'Chrome', '120.0.0'],
    });

    // Save credentials on update
    this.sock.ev.on('creds.update', saveCreds);

    // Connection state handler
    this.sock.ev.on('connection.update', async ({ connection, lastDisconnect, qr }) => {
      if (qr) {
        logger.info('WhatsApp QR code generated — scan with your phone:');
        qrcode.generate(qr, { small: true });
      }

      if (connection === 'open') {
        this.isReady = true;
        logger.info('WhatsApp (Baileys) client ready');
        await this.sendStartupMessage();
      }

      if (connection === 'close') {
        this.isReady = false;
        const statusCode = (lastDisconnect?.error as Boom)?.output?.statusCode;
        const loggedOut = statusCode === DisconnectReason.loggedOut;

        logger.warn('WhatsApp disconnected', { statusCode, loggedOut });

        if (!loggedOut && this.shouldReconnect) {
          logger.info('Reconnecting WhatsApp in 5s...');
          setTimeout(() => this.connect(), 5000);
        } else if (loggedOut) {
          logger.error('WhatsApp logged out — delete session folder and restart to re-authenticate');
        }
      }
    });

    // Incoming messages
    this.sock.ev.on('messages.upsert', async ({ messages, type }) => {
      if (type !== 'notify') return;

      for (const msg of messages) {
        if (!msg.message) continue;
        if (msg.key.fromMe) continue;  // skip own messages

        const from = msg.key.remoteJid!;
        const adminJid = toJid(config.adminWhatsappNumber);

        if (from !== adminJid) {
          await this.sock!.sendMessage(from, { text: 'Unauthorized.' });
          continue;
        }

        const text = (
          msg.message.conversation ||
          msg.message.extendedTextMessage?.text ||
          ''
        ).trim();

        if (!text) continue;

        logger.debug(`WhatsApp message from ${from}: ${text.substring(0, 80)}`);

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

        const message: NormalizedMessage = {
          platform: 'whatsapp',
          userId: from,
          chatId: from,
          text,
          timestamp: new Date((msg.messageTimestamp as number) * 1000),
          messageId: msg.key.id,
        };

        await gateway.receiveMessage(message);
      }
    });
  }

  private async sendResponse(response: NormalizedResponse): Promise<void> {
    if (!this.isReady || !this.sock) {
      logger.warn('WhatsApp (Baileys) client not ready, cannot send message');
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
      if (response.parseMode === 'Markdown') {
        text = text
          .replace(/\*\*(.*?)\*\*/g, '$1')
          .replace(/\*(.*?)\*/g, '$1')
          .replace(/`{3}[\s\S]*?`{3}/g, (match) => match.replace(/`{3}\w*\n?/g, ''))
          .replace(/`(.*?)`/g, '$1')
          .replace(/_{1,2}(.*?)_{1,2}/g, '$1')
          .replace(/\[(.*?)\]\(.*?\)/g, '$1');
      }

      const maxLength = 4000;
      if (text.length <= maxLength) {
        await this.sock.sendMessage(jid, { text });
      } else {
        const chunks = this.splitMessage(text, maxLength);
        for (const chunk of chunks) {
          await this.sock.sendMessage(jid, { text: chunk });
          await new Promise((resolve) => setTimeout(resolve, 500));
        }
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
      if (remaining.length <= maxLength) { chunks.push(remaining); break; }
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
      const jid = toJid(config.adminWhatsappNumber);
      const message =
        `${config.agentName} Online\n\n` +
        `Time: ${new Date().toISOString()}\n` +
        `VPS: ${config.vpsHostname} | ${ips.join(', ') || 'unknown'}\n` +
        `AI Model: ${config.aiModel}\n` +
        `Platform: WhatsApp (Baileys)\n\n` +
        `Ready for commands. Send !help for available commands.`;
      await this.sock.sendMessage(jid, { text: message });
    } catch (error: any) {
      logger.warn('Failed to send WhatsApp startup message', { error: error.message });
    }
  }

  async stop(): Promise<void> {
    this.shouldReconnect = false;
    try {
      if (this.sock) {
        this.sock.end(undefined);
        this.sock = null;
      }
      logger.info('WhatsApp (Baileys) client stopped');
    } catch (error: any) {
      logger.warn('Error stopping WhatsApp Baileys client', { error: error.message });
    }
  }

  isClientReady(): boolean {
    return this.isReady;
  }
}

export const whatsAppBaileysPlatform = new WhatsAppBaileysPlatform();
export default whatsAppBaileysPlatform;
```

---

## 8. ToolRegistry Conditional Loading

**File:** `src/brain/ToolRegistry.ts` — modify `registerAll()` to read `superclaw.config.json`.

```typescript
// src/brain/ToolRegistry.ts  (MODIFIED)

import { Tool } from '../gateway/types';
import { logger } from '../logger';
import { loadSuperclawConfig, isToolEnabled } from '../superclawConfig';

// Core tools — always imported (small, no heavy deps)
import { shellTool } from '../tools/ShellTool';
import { fileReadTool } from '../tools/FileReadTool';
import { fileWriteTool } from '../tools/FileWriteTool';
import { fileListTool } from '../tools/FileListTool';
import { httpRequestTool } from '../tools/HttpRequestTool';
import { packageManagerTool } from '../tools/PackageManagerTool';
import { serviceManagerTool } from '../tools/ServiceManagerTool';
import { cronManagerTool } from '../tools/CronManagerTool';
import { processManagerTool } from '../tools/ProcessManagerTool';
import { systemInfoTool } from '../tools/SystemInfoTool';
import { memoryReadTool } from '../tools/MemoryReadTool';
import { memoryWriteTool } from '../tools/MemoryWriteTool';
import { aiQueryTool } from '../tools/AiQueryTool';

export class ToolRegistry {
  private tools: Map<string, Tool> = new Map();

  constructor() {
    this.registerAll();
  }

  private registerAll(): void {
    const superclawConfig = loadSuperclawConfig();

    // Core tools — always registered
    const coreTools: Tool[] = [
      shellTool,
      fileReadTool,
      fileWriteTool,
      fileListTool,
      httpRequestTool,
      packageManagerTool,
      serviceManagerTool,
      cronManagerTool,
      processManagerTool,
      systemInfoTool,
      memoryReadTool,
      memoryWriteTool,
      aiQueryTool,
    ];

    for (const tool of coreTools) {
      this.tools.set(tool.name, tool);
      logger.debug(`Registered core tool: ${tool.name}`);
    }

    // Optional: web_search — only if enabled and SERPAPI_KEY present
    if (isToolEnabled(superclawConfig, 'web_search')) {
      try {
        const { webSearchTool } = require('../tools/WebSearchTool');
        this.tools.set(webSearchTool.name, webSearchTool);
        logger.debug('Registered optional tool: web_search');
      } catch (e: any) {
        logger.warn('web_search tool failed to load', { error: e.message });
      }
    } else {
      logger.debug('web_search tool disabled by config');
    }

    // Optional: code_executor
    if (isToolEnabled(superclawConfig, 'code_executor')) {
      try {
        const { codeExecutorTool } = require('../tools/CodeExecutorTool');
        this.tools.set(codeExecutorTool.name, codeExecutorTool);
        logger.debug('Registered optional tool: code_executor');
      } catch (e: any) {
        logger.warn('code_executor tool failed to load', { error: e.message });
      }
    } else {
      logger.debug('code_executor tool disabled by config');
    }

    logger.info(`ToolRegistry: ${this.tools.size} tools registered`);
  }

  // ... rest of ToolRegistry unchanged (register, getTool, getAllTools, etc.)
}
```

**Note:** `require()` is used for optional tools instead of `import` to avoid TypeScript static analysis errors when the module might not be installed. In a compiled JS context this is equivalent.

---

## 9. config.ts Changes

`src/config.ts` needs two changes:

1. `ADMIN_WHATSAPP_NUMBER` and `TELEGRAM_BOT_TOKEN` become **optional** (not `requireEnv`) since a Telegram-only install has no WhatsApp number, and a future WhatsApp-only install would have no Telegram token.
2. Add `whatsappDriver` field read from env (fallback to config file).

```typescript
// src/config.ts  (MODIFIED sections)

// Change these from requireEnv to optionalEnv:
telegramBotToken: optionalEnv('TELEGRAM_BOT_TOKEN'),   // was requireEnv
adminTelegramId: optionalEnv('ADMIN_TELEGRAM_ID'),     // was requireEnv
whatsappSessionName: optionalEnv('WHATSAPP_SESSION_NAME', 'superclaw'),
adminWhatsappNumber: optionalEnv('ADMIN_WHATSAPP_NUMBER'),  // was requireEnv

// Add to AgentConfig interface in types.ts:
// whatsappDriver?: 'baileys' | 'puppeteer';
```

**Also update `src/gateway/types.ts`** — add `whatsappDriver` to `AgentConfig`:

```typescript
export interface AgentConfig {
  // ... existing fields ...
  telegramBotToken: string;       // now optional string (empty = disabled)
  adminTelegramId: string;        // now optional string
  whatsappSessionName: string;
  adminWhatsappNumber: string;    // now optional string
  // ... rest unchanged ...
}
```

**Validation logic** in `config.ts` should be moved to runtime startup in `index.ts`, where we check: "if telegram is in platforms, TELEGRAM_BOT_TOKEN must be set" etc.

---

## 10. package.json Changes

### Strategy

- `whatsapp-web.js` and `puppeteer` become **`optionalDependencies`** — npm/pnpm will install them if possible but won't fail if they can't be installed (e.g., no Chromium available).
- `@whiskeysockets/baileys` and its peer deps become **regular `dependencies`** (they are the default driver).
- A new `install:lite` script installs without optional deps.

### New package.json

```json
{
  "name": "superclaw",
  "version": "2.0.0",
  "description": "Autonomous AI agent system — modular, memory-efficient",
  "main": "dist/index.js",
  "bin": {
    "superclaw": "dist/index.js"
  },
  "scripts": {
    "build": "tsc",
    "start": "node dist/index.js",
    "dev": "tsx src/index.ts",
    "setup": "tsx src/setup/wizard.ts",
    "lint": "tsc --noEmit",
    "install:lite": "npm install --ignore-optional",
    "install:full": "npm install"
  },
  "dependencies": {
    "grammy": "^1.21.1",
    "@whiskeysockets/baileys": "^6.7.0",
    "@hapi/boom": "^10.0.1",
    "pino": "^8.19.0",
    "qrcode-terminal": "^0.12.0",
    "openai": "^4.28.0",
    "@anthropic-ai/sdk": "^0.17.1",
    "better-sqlite3": "^9.4.3",
    "dotenv": "^16.4.5",
    "winston": "^3.11.0",
    "node-cron": "^3.0.3",
    "axios": "^1.6.7",
    "marked": "^12.0.0",
    "inquirer": "^9.2.15",
    "chalk": "^5.3.0"
  },
  "optionalDependencies": {
    "whatsapp-web.js": "^1.23.0",
    "puppeteer": "^22.3.0"
  },
  "devDependencies": {
    "typescript": "^5.3.3",
    "@types/node": "^20.11.20",
    "@types/better-sqlite3": "^7.6.8",
    "@types/inquirer": "^9.0.7",
    "@types/qrcode-terminal": "^0.12.2",
    "@types/node-cron": "^3.0.11",
    "ts-node": "^10.9.2",
    "tsx": "^4.7.1"
  },
  "engines": {
    "node": ">=20.0.0"
  }
}
```

### Baileys Peer Dependencies

Baileys requires these to be installed alongside it:

```
@hapi/boom        ^10.0.1   (error handling)
pino              ^8.19.0   (logger — we silence it)
```

These are added to `dependencies` above.

### install.sh Changes

The `install.sh` script should be updated to:
1. Run the wizard first (`npm run setup`)
2. Read the generated `superclaw.config.json`
3. If `whatsappDriver === 'baileys'` (or WhatsApp disabled), run `npm install --ignore-optional` to skip Puppeteer/Chromium download
4. If `whatsappDriver === 'puppeteer'`, run `npm install` (full install)

```bash
#!/bin/bash
# install.sh — updated

echo "Running SuperClaw setup wizard..."
npm run setup

# Read config
DRIVER=$(node -e "const c=require('./superclaw.config.json'); console.log(c.whatsappDriver)")
PLATFORMS=$(node -e "const c=require('./superclaw.config.json'); console.log(c.platforms.join(','))")

if [[ "$PLATFORMS" == *"whatsapp"* ]] && [[ "$DRIVER" == "puppeteer" ]]; then
  echo "Installing with Puppeteer (full install, ~1.5 GB)..."
  npm install
else
  echo "Installing without Puppeteer (lite install, ~600 MB)..."
  npm install --ignore-optional
fi

npm run build
echo "Installation complete."
```

---

## 11. File Change Summary

### New Files to Create

| File | Purpose |
|------|---------|
| `src/types/SuperclawConfig.ts` | TypeScript interface for superclaw.config.json |
| `src/superclawConfig.ts` | Config loader + helper functions |
| `src/platforms/WhatsAppBaileysPlatform.ts` | New Baileys-based WhatsApp platform |
| `plans/modular-architecture-spec.md` | This document |

### Files to Modify

| File | Change |
|------|--------|
| `src/index.ts` | Replace static imports with conditional dynamic `import()` |
| `src/brain/ToolRegistry.ts` | Add conditional tool loading based on config |
| `src/config.ts` | Make Telegram/WhatsApp fields optional |
| `src/gateway/types.ts` | Update `AgentConfig` interface |
| `src/setup/wizard.ts` | Add Steps A–F, write `superclaw.config.json` |
| `package.json` | Move puppeteer/whatsapp-web.js to optionalDependencies, add Baileys |
| `install.sh` | Conditional install based on config |

### Files Unchanged

| File | Reason |
|------|--------|
| `src/platforms/WhatsAppPlatform.ts` | Kept for Puppeteer compatibility path |
| `src/platforms/TelegramPlatform.ts` | No changes needed |
| `src/gateway/Gateway.ts` | No changes needed |
| `src/brain/Brain.ts` | No changes needed |
| `src/brain/PromptBuilder.ts` | No changes needed |
| `src/memory/*.ts` | No changes needed |
| `src/tools/*.ts` | No changes needed |
| `src/logger.ts` | No changes needed |

---

## 12. Memory Comparison vs OpenClaw

### OpenClaw (baseline)

OpenClaw uses `whatsapp-web.js` + Puppeteer as its only WhatsApp driver, always loaded at startup regardless of whether WhatsApp is configured.

| Component | OpenClaw RAM |
|-----------|-------------|
| Node.js runtime | ~35 MB |
| Telegram (grammy) | ~12 MB |
| whatsapp-web.js | ~60 MB |
| Chromium (Puppeteer) | ~380 MB |
| AI SDK + tools | ~25 MB |
| **Total minimum** | **~512 MB** |
| **Total typical** | **~700–900 MB** |

### SuperClaw v2 — Ultra-Lite Mode

| Component | SuperClaw Ultra-Lite RAM |
|-----------|--------------------------|
| Node.js runtime | ~35 MB |
| Telegram (grammy) | ~12 MB |
| AI SDK + tools | ~25 MB |
| WhatsApp | **0 MB** (disabled) |
| Chromium | **0 MB** (not installed) |
| **Total minimum** | **~72 MB** |
| **Total typical** | **~80–120 MB** |

**Savings vs OpenClaw: ~430–780 MB RAM, ~1 GB storage**

### SuperClaw v2 — Standard Mode (Baileys)

| Component | SuperClaw Standard RAM |
|-----------|------------------------|
| Node.js runtime | ~35 MB |
| Telegram (grammy) | ~12 MB |
| @whiskeysockets/baileys | ~30 MB |
| AI SDK + tools | ~25 MB |
| Chromium | **0 MB** (not installed) |
| **Total minimum** | **~102 MB** |
| **Total typical** | **~150–200 MB** |

**Savings vs OpenClaw: ~360–700 MB RAM, ~900 MB storage**

### Full Comparison Table

| Metric | OpenClaw | SuperClaw Ultra-Lite | SuperClaw Standard | SuperClaw Full |
|--------|----------|---------------------|-------------------|----------------|
| Min RAM | ~512 MB | ~72 MB | ~102 MB | ~512 MB |
| Typical RAM | ~700 MB | ~100 MB | ~175 MB | ~650 MB |
| Peak RAM | ~1 GB | ~150 MB | ~250 MB | ~900 MB |
| Storage | ~1.5 GB | ~500 MB | ~600 MB | ~1.5 GB |
| Chromium | Always | Never | Never | Always |
| WhatsApp | Always | Never | Baileys WS | Puppeteer |
| Telegram | Always | Yes | Yes | Yes |

### Marketing Claim (accurate)

> **SuperClaw uses up to 6× less RAM than OpenClaw** in Ultra-Lite mode (~100 MB vs ~700 MB), and **3.5× less RAM** in Standard mode with full WhatsApp support (~175 MB vs ~700 MB) — by replacing Puppeteer+Chromium with a pure WebSocket WhatsApp implementation.

---

## Implementation Order for Code Agent

Execute in this exact order to avoid broken intermediate states:

1. Create `src/types/SuperclawConfig.ts`
2. Create `src/superclawConfig.ts`
3. Modify `src/gateway/types.ts` — update `AgentConfig` interface
4. Modify `src/config.ts` — make platform fields optional
5. Create `src/platforms/WhatsAppBaileysPlatform.ts`
6. Modify `src/brain/ToolRegistry.ts` — conditional tool loading
7. Modify `src/index.ts` — conditional platform loading
8. Modify `src/setup/wizard.ts` — add Steps A–F + write config
9. Modify `package.json` — restructure dependencies
10. Modify `install.sh` — conditional install logic
11. Run `npm install` to pull in Baileys
12. Run `npm run build` to verify TypeScript compiles
