#!/usr/bin/env node
'use strict';

import * as readline from 'readline';
import * as fs from 'fs';
import * as path from 'path';
import { execSync, spawn } from 'child_process';

// Load .env — __dirname in compiled output is dist/cli/, so ../../.env is correct
const dotenvPath = path.join(__dirname, '../../.env');
if (fs.existsSync(dotenvPath)) {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  require('dotenv').config({ path: dotenvPath });
}

// eslint-disable-next-line @typescript-eslint/no-var-requires
const VERSION: string = require('../../package.json').version as string;
const AGENT_NAME: string = process.env.AGENT_NAME || 'SuperClaw';
const PROJECT_DIR: string = path.join(__dirname, '../..');

// ── Help ──────────────────────────────────────────────────────────────────────

function printHelp(): void {
  const nameVer = `${AGENT_NAME} CLI v${VERSION}`;
  const pad = Math.max(0, 51 - nameVer.length - 2);
  const padStr = ' '.repeat(pad);
  console.log(`
╔═══════════════════════════════════════════════════╗
║  ${nameVer}${padStr}  ║
╚═══════════════════════════════════════════════════╝

Usage: superclaw [command]

Commands:
  (no command)    Start interactive chat mode
  chat            Start interactive chat mode
  start           Start the agent daemon
  stop            Stop the agent daemon
  restart         Restart the agent daemon
  status          Show agent status
  logs            Tail agent logs
  setup           Run the setup wizard
  config          Edit superclaw.config.json
  env             Edit .env configuration
  update          Update to latest version
  doctor          Run health check diagnostics
  admin           Manage admin Telegram IDs (add/remove)
  admin list      List current admin IDs
  admin add       Add a new admin ID
  admin remove    Remove an admin ID
  version         Show version
  uninstall       Remove SuperClaw installation
  --help, -h      Show this help

Examples:
  superclaw               # Start chatting
  superclaw chat          # Start chatting
  superclaw restart       # Restart the daemon
  superclaw logs          # View live logs
  superclaw setup         # Reconfigure
`);
}

// ── Chat mode ─────────────────────────────────────────────────────────────────

async function runChat(): Promise<void> {
  // Dynamically require Brain and related singletons.
  // Using require() because the project is CommonJS and these modules
  // have side-effects (DB init, config loading) we want to defer.
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { initConversationDB } = require('../memory/ConversationDB') as typeof import('../memory/ConversationDB');
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { gateway } = require('../gateway/Gateway') as typeof import('../gateway/Gateway');
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { brain } = require('../brain/Brain') as typeof import('../brain/Brain');

  console.log(`\n🦀 ${AGENT_NAME} CLI Chat`);
  console.log('Type your message and press Enter. Type /exit to quit.\n');

  // Initialize DB (required before Brain can process messages)
  await initConversationDB();

  // Wire Brain to Gateway
  gateway.setMessageHandler(async (message) => {
    return brain.process(message);
  });

  const CLI_USER_ID = 'cli-user';
  const CLI_PLATFORM = 'cli' as const;
  const CLI_CHAT_ID = 'cli-chat';

  // Buffer to capture the Brain's response synchronously within the readline flow
  let pendingResolve: ((text: string) => void) | null = null;

  // Register CLI as a platform sender so Gateway can deliver responses back
  gateway.registerPlatform(CLI_PLATFORM, async (response) => {
    const text = response.text;
    if (pendingResolve) {
      pendingResolve(text);
      pendingResolve = null;
    } else {
      // Proactive message (e.g. sub-agent notification) — print immediately
      console.log(`\n🤖 ${AGENT_NAME}: ${text}\n`);
    }
  });

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: 'You: ',
  });

  rl.prompt();

  rl.on('line', async (line: string) => {
    const input = line.trim();

    if (!input) {
      rl.prompt();
      return;
    }

    // ── Slash commands ──────────────────────────────────────
    if (input === '/exit' || input === '/quit') {
      console.log('Goodbye! 👋');
      rl.close();
      process.exit(0);
    }

    if (input === '/help') {
      console.log(
        '\nAvailable commands:\n' +
        '  /exit  - Exit chat\n' +
        '  /quit  - Exit chat\n' +
        '  /clear - Clear conversation history\n' +
        '  /help  - Show this help\n'
      );
      rl.prompt();
      return;
    }

    if (input === '/clear') {
      try {
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const { getConversationDB } = require('../memory/ConversationDB') as typeof import('../memory/ConversationDB');
        getConversationDB().clearHistory(CLI_USER_ID, CLI_PLATFORM);
        console.log('✅ Conversation history cleared.\n');
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`Failed to clear history: ${msg}\n`);
      }
      rl.prompt();
      return;
    }

    // ── Send to Brain ───────────────────────────────────────
    // Show thinking indicator (overwritten when response arrives)
    process.stdout.write(`\n🤖 ${AGENT_NAME}: thinking...\r`);

    // Create a promise that resolves when the Gateway delivers the response
    const responsePromise = new Promise<string>((resolve) => {
      pendingResolve = resolve;
    });

    try {
      await gateway.receiveMessage({
        platform: CLI_PLATFORM,
        userId: CLI_USER_ID,
        chatId: CLI_CHAT_ID,
        text: input,
        timestamp: new Date(),
      });

      // Wait for the sender callback to fire
      const response = await responsePromise;

      // Clear the "thinking..." line and print the response
      process.stdout.write('\r' + ' '.repeat(60) + '\r');
      console.log(`🤖 ${AGENT_NAME}: ${response}\n`);
    } catch (err: unknown) {
      // Clear thinking indicator
      process.stdout.write('\r' + ' '.repeat(60) + '\r');
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`❌ Error: ${msg}\n`);
      // Ensure pendingResolve doesn't leak
      pendingResolve = null;
    }

    rl.prompt();
  });

  rl.on('close', () => {
    process.exit(0);
  });

  // Handle Ctrl+C gracefully
  process.on('SIGINT', () => {
    console.log('\nGoodbye! 👋');
    process.exit(0);
  });
}

// ── Admin management ──────────────────────────────────────────────────────────

async function manageAdmins(subcommand?: string): Promise<void> {
  const envPath = path.join(PROJECT_DIR, '.env');

  if (!fs.existsSync(envPath)) {
    console.error('❌ .env file not found. Run: superclaw setup');
    process.exit(1);
  }

  // Read current .env
  let envContent = fs.readFileSync(envPath, 'utf8');

  // Parse current admin IDs
  const match = envContent.match(/^ADMIN_TELEGRAM_ID=(.*)$/m);
  const currentIds = match
    ? match[1].replace(/\r/g, '').split(',').map((s: string) => s.trim()).filter(Boolean)
    : [];

  function saveAdminIds(ids: string[]): void {
    const newLine = `ADMIN_TELEGRAM_ID=${ids.join(',')}`;
    if (match) {
      envContent = envContent.replace(/^ADMIN_TELEGRAM_ID=.*$/m, newLine);
    } else {
      envContent += `\n${newLine}`;
    }
    fs.writeFileSync(envPath, envContent, 'utf8');
    console.log(`✅ Admin IDs updated: ${ids.join(', ')}`);
    console.log('Restart SuperClaw to apply: superclaw restart');
  }

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const question = (q: string): Promise<string> =>
    new Promise((resolve) => rl.question(q, resolve));

  if (subcommand === 'list' || !subcommand) {
    console.log('\n👥 Current admin Telegram IDs:');
    if (currentIds.length === 0) {
      console.log('  (none configured)');
    } else {
      currentIds.forEach((id: string, i: number) => console.log(`  ${i + 1}. ${id}`));
    }

    if (!subcommand) {
      // Interactive menu
      console.log('\nOptions:');
      console.log('  1. Add admin');
      console.log('  2. Remove admin');
      console.log('  3. Exit');
      const choice = await question('\nChoice (1-3): ');

      if (choice.trim() === '1') {
        const newId = await question('Enter Telegram user ID to add: ');
        const trimmed = newId.trim().replace(/\r/g, '');
        if (!/^\d+$/.test(trimmed)) {
          console.error('❌ Invalid ID — must be a number');
        } else if (currentIds.includes(trimmed)) {
          console.log('ℹ️  This ID is already an admin');
        } else {
          saveAdminIds([...currentIds, trimmed]);
        }
      } else if (choice.trim() === '2') {
        if (currentIds.length === 0) {
          console.log('No admins to remove.');
        } else {
          currentIds.forEach((id: string, i: number) => console.log(`  ${i + 1}. ${id}`));
          const idx = await question('Enter number to remove: ');
          const index = parseInt(idx, 10) - 1;
          if (index >= 0 && index < currentIds.length) {
            const removed = currentIds.splice(index, 1)[0];
            saveAdminIds(currentIds);
            console.log(`Removed admin: ${removed}`);
          } else {
            console.error('Invalid selection');
          }
        }
      }
    }
  } else if (subcommand === 'add') {
    const newId = await question('Enter Telegram user ID to add as admin: ');
    const trimmed = newId.trim().replace(/\r/g, '');
    if (!/^\d+$/.test(trimmed)) {
      console.error('❌ Invalid ID — must be a number (get it from @userinfobot on Telegram)');
    } else if (currentIds.includes(trimmed)) {
      console.log('ℹ️  This ID is already an admin');
    } else {
      saveAdminIds([...currentIds, trimmed]);
    }
  } else if (subcommand === 'remove') {
    if (currentIds.length === 0) {
      console.log('No admins configured.');
    } else {
      console.log('\nCurrent admins:');
      currentIds.forEach((id: string, i: number) => console.log(`  ${i + 1}. ${id}`));
      const idx = await question('Enter number to remove: ');
      const index = parseInt(idx, 10) - 1;
      if (index >= 0 && index < currentIds.length) {
        const removed = currentIds.splice(index, 1)[0];
        saveAdminIds(currentIds);
        console.log(`✅ Removed admin: ${removed}`);
      } else {
        console.error('❌ Invalid selection');
      }
    }
  } else {
    console.error(`Unknown admin subcommand: ${subcommand}`);
    console.log('Usage: superclaw admin [list|add|remove]');
    process.exit(1);
  }

  rl.close();
}

// ── Utility helpers ───────────────────────────────────────────────────────────

function runCommand(cmd: string, args: string[] = []): void {
  try {
    execSync(`${cmd} ${args.join(' ')}`, { stdio: 'inherit', cwd: PROJECT_DIR });
  } catch {
    // execSync throws on non-zero exit, but stdio: 'inherit' already printed the error
  }
}

function hasPm2(): boolean {
  try {
    execSync('pm2 --version', { stdio: 'pipe' });
    return true;
  } catch {
    return false;
  }
}

function openEditor(filePath: string): void {
  const editor = process.env.EDITOR || (process.platform === 'win32' ? 'notepad' : 'nano');
  const child = spawn(editor, [filePath], { stdio: 'inherit' });
  child.on('exit', () => process.exit(0));
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const command = args[0] || 'chat';

  switch (command) {
    case 'chat':
      await runChat();
      break;

    case '--help':
    case '-h':
    case 'help':
      printHelp();
      break;

    case 'version':
    case '--version':
    case '-v':
      console.log(`${AGENT_NAME} v${VERSION}`);
      break;

    case 'start':
      if (hasPm2()) {
        runCommand('pm2', ['start', 'ecosystem.config.js', '--env', 'production']);
      } else {
        console.log('Starting SuperClaw (no PM2 found, running directly)...');
        runCommand('node', [path.join(PROJECT_DIR, 'dist/index.js')]);
      }
      break;

    case 'stop':
      if (hasPm2()) {
        runCommand('pm2', ['stop', 'superclaw']);
      } else {
        console.log('PM2 not found. Kill the process manually.');
      }
      break;

    case 'restart':
      if (hasPm2()) {
        runCommand('pm2', ['restart', 'superclaw']);
      } else {
        console.log('PM2 not found. Restart manually.');
      }
      break;

    case 'status':
      if (hasPm2()) {
        runCommand('pm2', ['status']);
      } else {
        console.log('PM2 not found. Cannot show status.');
      }
      break;

    case 'logs':
      if (hasPm2()) {
        runCommand('pm2', ['logs', 'superclaw', '--lines', '50']);
      } else {
        runCommand('tail', ['-f', path.join(PROJECT_DIR, 'logs/app.log')]);
      }
      break;

    case 'setup':
      runCommand('node', [path.join(PROJECT_DIR, 'dist/setup/wizard.js')]);
      break;

    case 'config':
      openEditor(path.join(PROJECT_DIR, 'superclaw.config.json'));
      break;

    case 'env':
      openEditor(path.join(PROJECT_DIR, '.env'));
      break;

    case 'update':
      console.log('Updating SuperClaw...');
      runCommand('git', ['pull']);
      runCommand('pnpm', ['install']);
      runCommand('pnpm', ['build']);
      if (hasPm2()) {
        runCommand('pm2', ['restart', 'superclaw']);
      }
      console.log('✅ Update complete!');
      break;

    case 'doctor':
      runCommand('node', [path.join(PROJECT_DIR, 'dist/doctor.js')]);
      break;

    case 'admin':
      await manageAdmins(args[1]);
      break;

    case 'uninstall': {
      const rl2 = readline.createInterface({ input: process.stdin, output: process.stdout });
      rl2.question(
        'Are you sure you want to uninstall SuperClaw? This will delete all data. (yes/no): ',
        (answer: string) => {
          rl2.close();
          if (answer.toLowerCase() === 'yes') {
            if (hasPm2()) runCommand('pm2', ['delete', 'superclaw']);
            console.log(`To fully remove, delete the directory: ${PROJECT_DIR}`);
          } else {
            console.log('Uninstall cancelled.');
          }
          process.exit(0);
        }
      );
      break;
    }

    default:
      console.log(`Unknown command: ${command}`);
      printHelp();
      process.exit(1);
  }
}

main().catch((err: unknown) => {
  const msg = err instanceof Error ? err.message : String(err);
  console.error(`CLI error: ${msg}`);
  process.exit(1);
});
