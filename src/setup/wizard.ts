import inquirer from 'inquirer';
import chalk from 'chalk';
import fs from 'fs';
import path from 'path';
import { SuperclawConfig } from '../types/SuperclawConfig';

const ENV_PATH = path.resolve(process.cwd(), '.env');
const CONFIG_PATH = path.resolve(process.cwd(), 'superclaw.config.json');

// RAM estimates in MB
const RAM = {
  base: 80,
  telegram: 30,
  whatsappBaileys: 40,
  whatsappPuppeteer: 450,
  webSearch: 5,
  codeExecutor: 5,
};

// Storage estimates in MB
const STORAGE = {
  base: 300,
  telegram: 50,
  whatsappBaileys: 80,
  whatsappPuppeteer: 900,
};

function calcRam(platforms: string[], driver: string, tools: string[]): number {
  let ram = RAM.base;
  if (platforms.includes('telegram')) ram += RAM.telegram;
  if (platforms.includes('whatsapp')) {
    ram += driver === 'baileys' ? RAM.whatsappBaileys : RAM.whatsappPuppeteer;
  }
  if (tools.includes('web_search')) ram += RAM.webSearch;
  if (tools.includes('code_executor')) ram += RAM.codeExecutor;
  return ram;
}

function calcStorage(platforms: string[], driver: string): number {
  let storage = STORAGE.base;
  if (platforms.includes('telegram')) storage += STORAGE.telegram;
  if (platforms.includes('whatsapp')) {
    storage += driver === 'baileys' ? STORAGE.whatsappBaileys : STORAGE.whatsappPuppeteer;
  }
  return storage;
}

function ramBar(mb: number): string {
  const max = 600;
  const filled = Math.round((mb / max) * 20);
  const bar = '█'.repeat(Math.min(filled, 20)) + '░'.repeat(Math.max(20 - filled, 0));
  const color = mb < 200 ? chalk.green : mb < 400 ? chalk.yellow : chalk.red;
  return color(`[${bar}] ~${mb} MB RAM`);
}

function printBanner(): void {
  console.log(chalk.cyan('\n╔══════════════════════════════════════════╗'));
  console.log(chalk.cyan('║     SuperClaw Setup Wizard v2            ║'));
  console.log(chalk.cyan('║   Modular • Lightweight • Autonomous      ║'));
  console.log(chalk.cyan('╚══════════════════════════════════════════╝\n'));
  console.log(chalk.gray('SuperClaw is designed to run on minimal resources.'));
  console.log(chalk.gray('Choose only what you need to keep memory usage low.\n'));
}

function getDefaultModel(provider: string): string {
  switch (provider) {
    case 'openai': return 'gpt-4o';
    case 'anthropic': return 'claude-3-5-sonnet-20241022';
    case 'groq': return 'llama-3.3-70b-versatile';
    case 'ollama': return 'llama3';
    case 'custom': return 'mistral-7b-instruct';
    default: return 'gpt-4o';
  }
}

async function testCustomConnection(
  baseURL: string,
  model: string,
  apiKey: string
): Promise<{ ok: boolean; error?: string }> {
  try {
    const OpenAI = (await import('openai')).default;
    const client = new OpenAI({
      baseURL,
      apiKey: apiKey || 'none',
      defaultHeaders: apiKey ? undefined : {},
    });
    // Send minimal test — no max_tokens, no stream, just a simple message
    await client.chat.completions.create({
      model,
      messages: [{ role: 'user', content: 'hi' }],
    });
    return { ok: true };
  } catch (err: any) {
    const msg = err?.message || err?.toString() || 'Unknown error';
    return { ok: false, error: msg };
  }
}

async function fetchAvailableModels(baseURL: string, apiKey: string): Promise<string[]> {
  try {
    const OpenAI = (await import('openai')).default;
    const client = new OpenAI({ baseURL, apiKey: apiKey || 'none' });
    const response = await client.models.list();
    return response.data.map((m: any) => m.id).sort();
  } catch {
    return [];
  }
}

async function runWizard(): Promise<void> {
  printBanner();

  // ── STEP 1: Platform Selection ──────────────────────────
  console.log(chalk.bold.cyan('\n📱 STEP 1: Choose Platforms\n'));
  console.log(chalk.gray('Estimated RAM per platform:'));
  console.log(chalk.green(`  Telegram only:              ~${RAM.base + RAM.telegram} MB`));
  console.log(chalk.green(`  WhatsApp only (Baileys):    ~${RAM.base + RAM.whatsappBaileys} MB`));
  console.log(chalk.yellow(`  WhatsApp only (Puppeteer):  ~${RAM.base + RAM.whatsappPuppeteer} MB`));
  console.log(chalk.green(`  Both (Baileys):             ~${RAM.base + RAM.telegram + RAM.whatsappBaileys} MB`));
  console.log(chalk.yellow(`  Both (Puppeteer):           ~${RAM.base + RAM.telegram + RAM.whatsappPuppeteer} MB\n`));

  const { platforms } = await inquirer.prompt<{ platforms: string[] }>([
    {
      type: 'checkbox',
      name: 'platforms',
      message: 'Which platforms do you want to enable?',
      choices: [
        { name: `Telegram  ${chalk.green('(+30 MB, lightweight)')}`, value: 'telegram', checked: true },
        { name: `WhatsApp  ${chalk.yellow('(+40–450 MB depending on driver)')}`, value: 'whatsapp', checked: true },
      ],
      validate: (val: string[]) => val.length > 0 ? true : 'Select at least one platform',
    },
  ]);

  // ── STEP 2: WhatsApp Driver ─────────────────────────────
  let whatsappDriver: 'baileys' | 'puppeteer' = 'baileys';

  if (platforms.includes('whatsapp')) {
    console.log(chalk.bold.cyan('\n⚙️  STEP 2: WhatsApp Driver\n'));
    console.log(chalk.gray('Choose how SuperClaw connects to WhatsApp:\n'));
    console.log(chalk.green('  Baileys (recommended):'));
    console.log(chalk.gray('    • Pure Node.js WebSocket — no browser required'));
    console.log(chalk.gray(`    • RAM: ~${RAM.whatsappBaileys} MB extra`));
    console.log(chalk.gray('    • Storage: ~80 MB extra\n'));
    console.log(chalk.yellow('  Puppeteer (compatibility):'));
    console.log(chalk.gray('    • Runs a full headless Chromium browser'));
    console.log(chalk.gray(`    • RAM: ~${RAM.whatsappPuppeteer} MB extra`));
    console.log(chalk.gray('    • Storage: ~900 MB extra'));
    console.log(chalk.gray('    • More compatible but very heavy\n'));

    const { driver } = await inquirer.prompt<{ driver: 'baileys' | 'puppeteer' }>([
      {
        type: 'list',
        name: 'driver',
        message: 'Which WhatsApp driver?',
        choices: [
          { name: `Baileys  ${chalk.green('✓ Recommended — ~40 MB, no Chromium')}`, value: 'baileys' },
          { name: `Puppeteer  ${chalk.yellow('⚠ Heavy — ~450 MB, requires Chromium')}`, value: 'puppeteer' },
        ],
        default: 'baileys',
      },
    ]);
    whatsappDriver = driver;
  }

  // ── STEP 3: Optional Tools ──────────────────────────────
  console.log(chalk.bold.cyan('\n🛠️  STEP 3: Optional Tools\n'));
  console.log(chalk.gray('Core tools are always enabled. Choose optional extras:\n'));

  const { optionalTools } = await inquirer.prompt<{ optionalTools: string[] }>([
    {
      type: 'checkbox',
      name: 'optionalTools',
      message: 'Enable optional tools?',
      choices: [
        {
          name: `web_search  ${chalk.gray('(SerpAPI or DuckDuckGo — +5 MB)')}`,
          value: 'web_search',
          checked: true,
        },
        {
          name: `code_executor  ${chalk.gray('(Python/Bash/Node.js sandbox — +5 MB)')}`,
          value: 'code_executor',
          checked: true,
        },
      ],
    },
  ]);

  // ── STEP 4: AI Provider ─────────────────────────────────
  console.log(chalk.bold.cyan('\n🤖 STEP 4: AI Provider\n'));

  const { aiProvider } = await inquirer.prompt<{ aiProvider: string }>([
    {
      type: 'list',
      name: 'aiProvider',
      message: 'Which AI provider?',
      choices: [
        { name: 'OpenAI (GPT-4o)', value: 'openai' },
        { name: 'Anthropic (Claude 3.5 Sonnet)', value: 'anthropic' },
        { name: 'Groq (Llama 3 — fast & free tier)', value: 'groq' },
        { name: 'Ollama (local models)', value: 'ollama' },
        { name: 'Custom (OpenAI-compatible)', value: 'custom' },
      ],
      default: 'openai',
    },
  ]);

  const { aiModel } = await inquirer.prompt<{ aiModel: string }>([
    {
      type: 'input',
      name: 'aiModel',
      message: 'AI Model:',
      default: getDefaultModel(aiProvider),
    },
  ]);

  // API key questions
  const apiAnswers = await inquirer.prompt<any>([
    {
      type: 'password',
      name: 'openaiApiKey',
      message: 'OpenAI API Key (sk-...):',
      when: () => aiProvider === 'openai',
      validate: (val: string) => val.startsWith('sk-') ? true : 'Must start with sk-',
    },
    {
      type: 'password',
      name: 'anthropicApiKey',
      message: 'Anthropic API Key (sk-ant-...):',
      when: () => aiProvider === 'anthropic',
      validate: (val: string) => val.length > 10 ? true : 'Please enter a valid API key',
    },
    {
      type: 'password',
      name: 'groqApiKey',
      message: 'Groq API Key (gsk_...):',
      when: () => aiProvider === 'groq',
      validate: (val: string) => val.length > 10 ? true : 'Please enter a valid API key',
    },
    {
      type: 'input',
      name: 'ollamaBaseUrl',
      message: 'Ollama base URL:',
      default: 'http://localhost:11434',
      when: () => aiProvider === 'ollama',
    },
  ]);

  // ── Custom provider: collect details + test connection ──
  let customAiBaseUrl = '';
  let customAiModel = aiModel;
  let customAiApiKey = '';

  if (aiProvider === 'custom') {
    console.log(chalk.bold.cyan('\n🔌 Custom Provider Setup\n'));
    console.log(chalk.gray('Enter the details for your OpenAI-compatible endpoint.\n'));

    const urlAndKeyDetails = await inquirer.prompt<{
      customBaseUrl: string;
      customApiKey: string;
    }>([
      {
        type: 'input',
        name: 'customBaseUrl',
        message: 'Base URL (e.g. https://api.openrouter.ai/v1 or http://localhost:11434/v1):',
        default: 'https://api.openrouter.ai/v1',
        validate: (val: string) => val.startsWith('http') ? true : 'Must be a valid URL starting with http',
      },
      {
        type: 'password',
        name: 'customApiKey',
        message: 'API Key (leave empty for local/no-auth models):',
        default: '',
      },
    ]);

    customAiBaseUrl = urlAndKeyDetails.customBaseUrl;
    customAiApiKey = urlAndKeyDetails.customApiKey;

    // Fetch available models from /v1/models
    console.log(chalk.gray('\n  Fetching available models from endpoint...'));
    const availableModels = await fetchAvailableModels(customAiBaseUrl, customAiApiKey);

    if (availableModels.length > 0) {
      const modelChoices = [
        ...availableModels.map((m) => ({ name: m, value: m })),
        { name: chalk.gray('── Enter manually ──'), value: '__manual__' },
      ];
      const { selectedModel } = await inquirer.prompt<{ selectedModel: string }>([
        {
          type: 'list',
          name: 'selectedModel',
          message: 'Select model:',
          choices: modelChoices,
          default: availableModels[0],
        },
      ]);
      if (selectedModel === '__manual__') {
        const { manualModel } = await inquirer.prompt<{ manualModel: string }>([
          {
            type: 'input',
            name: 'manualModel',
            message: 'Model name:',
            default: aiModel,
            validate: (val: string) => val.trim().length > 0 ? true : 'Model name cannot be empty',
          },
        ]);
        customAiModel = manualModel;
      } else {
        customAiModel = selectedModel;
      }
    } else {
      // Fallback to free-text input if fetch failed
      const { manualModel } = await inquirer.prompt<{ manualModel: string }>([
        {
          type: 'input',
          name: 'manualModel',
          message: 'Model name (e.g. mistral-7b, gpt-4o, llama3):',
          default: aiModel,
          validate: (val: string) => val.trim().length > 0 ? true : 'Model name cannot be empty',
        },
      ]);
      customAiModel = manualModel;
    }

    // Test connection with retry loop
    let connectionOk = false;
    while (!connectionOk) {
      console.log(chalk.gray('\n  Testing connection…'));
      const result = await testCustomConnection(customAiBaseUrl, customAiModel, customAiApiKey);

      if (result.ok) {
        console.log(chalk.green('  ✅ Connection successful!'));
        connectionOk = true;
      } else {
        console.log(chalk.red(`  ❌ Connection failed: ${result.error}`));
        const { retryAction } = await inquirer.prompt<{ retryAction: 'retry' | 'skip' }>([
          {
            type: 'list',
            name: 'retryAction',
            message: 'What would you like to do?',
            choices: [
              { name: 'Retry with different settings', value: 'retry' },
              { name: 'Skip test and continue anyway', value: 'skip' },
            ],
          },
        ]);

        if (retryAction === 'skip') {
          console.log(chalk.yellow('  ⚠️  Skipping connection test. Make sure your settings are correct.'));
          connectionOk = true;
        } else {
          // Re-prompt for custom details
          const retryUrlAndKey = await inquirer.prompt<{
            customBaseUrl: string;
            customApiKey: string;
          }>([
            {
              type: 'input',
              name: 'customBaseUrl',
              message: 'Base URL:',
              default: customAiBaseUrl,
              validate: (val: string) => val.startsWith('http') ? true : 'Must be a valid URL starting with http',
            },
            {
              type: 'password',
              name: 'customApiKey',
              message: 'API Key (leave empty for local/no-auth models):',
              default: '',
            },
          ]);
          customAiBaseUrl = retryUrlAndKey.customBaseUrl;
          customAiApiKey = retryUrlAndKey.customApiKey;

          // Re-fetch models after URL/key change
          console.log(chalk.gray('\n  Fetching available models from endpoint...'));
          const retryModels = await fetchAvailableModels(customAiBaseUrl, customAiApiKey);

          if (retryModels.length > 0) {
            const retryChoices = [
              ...retryModels.map((m) => ({ name: m, value: m })),
              { name: chalk.gray('── Enter manually ──'), value: '__manual__' },
            ];
            const { retrySelectedModel } = await inquirer.prompt<{ retrySelectedModel: string }>([
              {
                type: 'list',
                name: 'retrySelectedModel',
                message: 'Select model:',
                choices: retryChoices,
                default: retryModels[0],
              },
            ]);
            if (retrySelectedModel === '__manual__') {
              const { retryManualModel } = await inquirer.prompt<{ retryManualModel: string }>([
                {
                  type: 'input',
                  name: 'retryManualModel',
                  message: 'Model name:',
                  default: customAiModel,
                  validate: (val: string) => val.trim().length > 0 ? true : 'Model name cannot be empty',
                },
              ]);
              customAiModel = retryManualModel;
            } else {
              customAiModel = retrySelectedModel;
            }
          } else {
            const { retryManualModel } = await inquirer.prompt<{ retryManualModel: string }>([
              {
                type: 'input',
                name: 'retryManualModel',
                message: 'Model name:',
                default: customAiModel,
                validate: (val: string) => val.trim().length > 0 ? true : 'Model name cannot be empty',
              },
            ]);
            customAiModel = retryManualModel;
          }
        }
      }
    }

    // Store custom values back into apiAnswers for buildEnvContent
    apiAnswers.customAiBaseUrl = customAiBaseUrl;
    apiAnswers.customAiModel = customAiModel;
    apiAnswers.customAiApiKey = customAiApiKey;
  }

  // ── STEP 5: Platform Credentials ───────────────────────
  console.log(chalk.bold.cyan('\n🔑 STEP 5: Platform Credentials\n'));

  const credAnswers = await inquirer.prompt<any>([
    {
      type: 'password',
      name: 'telegramBotToken',
      message: 'Telegram Bot Token (from @BotFather):',
      when: () => platforms.includes('telegram'),
      validate: (val: string) => val.includes(':') ? true : 'Invalid token format (should contain :)',
    },
    {
      type: 'input',
      name: 'adminTelegramId',
      message: 'Your Telegram User ID (from @userinfobot):',
      when: () => platforms.includes('telegram'),
      validate: (val: string) => /^\d+$/.test(val) ? true : 'Must be a numeric ID',
    },
    {
      type: 'input',
      name: 'adminWhatsappNumber',
      message: whatsappDriver === 'baileys'
        ? 'Your WhatsApp number (format: 15551234567@s.whatsapp.net):'
        : 'Your WhatsApp number (format: 15551234567@c.us):',
      when: () => platforms.includes('whatsapp'),
      validate: (val: string) =>
        (val.includes('@s.whatsapp.net') || val.includes('@c.us'))
          ? true
          : 'Must include @s.whatsapp.net (Baileys) or @c.us (Puppeteer)',
    },
    {
      type: 'input',
      name: 'whatsappSessionName',
      message: 'WhatsApp session name:',
      default: 'superclaw',
      when: () => platforms.includes('whatsapp'),
    },
  ]);

  // ── STEP 6: Agent & VPS Settings ───────────────────────
  console.log(chalk.bold.cyan('\n🖥️  STEP 6: Agent & VPS Settings\n'));

  const agentAnswers = await inquirer.prompt<any>([
    {
      type: 'input',
      name: 'agentName',
      message: 'Agent name:',
      default: 'SuperClaw',
    },
    {
      type: 'input',
      name: 'vpsHostname',
      message: 'VPS hostname:',
      default: 'my-vps',
    },
    {
      type: 'list',
      name: 'logLevel',
      message: 'Log level:',
      choices: ['info', 'debug', 'warn', 'error'],
      default: 'info',
    },
    {
      type: 'input',
      name: 'serpApiKey',
      message: 'SerpAPI key (optional, press Enter to skip):',
      default: '',
      when: () => optionalTools.includes('web_search'),
    },
  ]);

  // ── STEP 7: Final Summary ───────────────────────────────
  const enabledTools = [
    'shell_execute', 'file_read', 'file_write', 'file_list',
    'http_request', 'package_manager', 'service_manager', 'cron_manager',
    'process_manager', 'system_info', 'memory_read', 'memory_write', 'ai_query',
    ...optionalTools,
  ];
  const disabledTools = ['web_search', 'code_executor'].filter((t) => !optionalTools.includes(t));
  const estimatedRam = calcRam(platforms, whatsappDriver, optionalTools);
  const estimatedStorage = calcStorage(platforms, whatsappDriver);

  console.log(chalk.bold.cyan('\n📊 STEP 7: Configuration Summary\n'));
  console.log(chalk.white('  Platforms:    ') + chalk.green(platforms.join(', ')));
  if (platforms.includes('whatsapp')) {
    console.log(
      chalk.white('  WA Driver:    ') +
      (whatsappDriver === 'baileys'
        ? chalk.green('Baileys (lightweight)')
        : chalk.yellow('Puppeteer (heavy)'))
    );
  }
  console.log(chalk.white('  AI Provider:  ') + chalk.green(`${aiProvider} / ${aiModel}`));
  console.log(
    chalk.white('  Tools:        ') +
    chalk.green(`${enabledTools.length} enabled`) +
    (disabledTools.length > 0 ? chalk.gray(`, ${disabledTools.length} disabled`) : '')
  );
  console.log(chalk.white('\n  Memory Footprint:'));
  console.log('  ' + ramBar(estimatedRam));
  console.log(chalk.white(`  Storage:      `) + chalk.cyan(`~${estimatedStorage} MB`));

  // Compare to OpenClaw baseline
  const openClawRam = 600;
  const savings = openClawRam - estimatedRam;
  if (savings > 0) {
    console.log(chalk.green(`\n  ✓ ${savings} MB lighter than a typical OpenClaw setup (~${openClawRam} MB)`));
    console.log(chalk.green(`  ✓ ${Math.round((savings / openClawRam) * 100)}% less RAM usage`));
  }

  const { confirmed } = await inquirer.prompt<{ confirmed: boolean }>([
    {
      type: 'confirm',
      name: 'confirmed',
      message: 'Write configuration and continue?',
      default: true,
    },
  ]);

  if (!confirmed) {
    console.log(chalk.yellow('\nSetup cancelled. Run again to reconfigure.'));
    process.exit(0);
  }

  // ── Write Files ─────────────────────────────────────────
  const allAnswers = {
    ...apiAnswers,
    ...credAnswers,
    ...agentAnswers,
    aiProvider,
    aiModel,
  };

  // Write .env
  const envContent = buildEnvContent(allAnswers, platforms);
  fs.writeFileSync(ENV_PATH, envContent);
  console.log(chalk.green('\n✅ .env written'));

  // Write superclaw.config.json
  const superclawConfig: SuperclawConfig & { aiProvider: string } = {
    schemaVersion: 1,
    platforms: platforms as Array<'telegram' | 'whatsapp'>,
    whatsappDriver,
    aiProvider,
    enabledTools,
    disabledTools,
    estimatedRamMb: estimatedRam,
    generatedAt: new Date().toISOString(),
  };
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(superclawConfig, null, 2));
  console.log(chalk.green('✅ superclaw.config.json written'));

  // Create directories
  createDirectories();

  // Generate memory files
  generateSoul(agentAnswers.agentName || 'SuperClaw');
  generateMemory();

  // Final instructions
  console.log(chalk.cyan('\n╔══════════════════════════════════════════╗'));
  console.log(chalk.cyan('║           Setup Complete! 🎉             ║'));
  console.log(chalk.cyan('╚══════════════════════════════════════════╝\n'));
  console.log(chalk.white('Next steps:'));
  console.log(chalk.gray('  1. Install dependencies:  ') + chalk.yellow('pnpm install'));
  console.log(chalk.gray('  2. Build TypeScript:      ') + chalk.yellow('pnpm build'));
  console.log(chalk.gray('  3. Start with PM2:        ') + chalk.yellow('pm2 start ecosystem.config.js'));
  console.log(chalk.gray('  4. Or run directly:       ') + chalk.yellow('pnpm start'));
  if (platforms.includes('whatsapp')) {
    console.log(chalk.gray('\n  On first WhatsApp run, scan the QR code in the terminal.\n'));
  }
}

function buildEnvContent(answers: any, platforms: string[]): string {
  const lines = [
    '# SuperClaw Configuration',
    `# Generated: ${new Date().toISOString()}`,
    '',
    '# AI Provider',
    `AI_PROVIDER=${answers.aiProvider || 'openai'}`,
    `AI_MODEL=${answers.aiModel || 'gpt-4o'}`,
    '',
    '# API Keys',
    `OPENAI_API_KEY=${answers.openaiApiKey || ''}`,
    `ANTHROPIC_API_KEY=${answers.anthropicApiKey || ''}`,
    `GROQ_API_KEY=${answers.groqApiKey || ''}`,
    `OLLAMA_BASE_URL=${answers.ollamaBaseUrl || 'http://localhost:11434'}`,
    '',
    '# Custom OpenAI-compatible provider (used when AI_PROVIDER=custom)',
    `CUSTOM_AI_BASE_URL=${answers.customAiBaseUrl || ''}`,
    `CUSTOM_AI_MODEL=${answers.customAiModel || ''}`,
    `CUSTOM_AI_API_KEY=${answers.customAiApiKey || ''}`,
    '',
    '# Telegram',
    `TELEGRAM_BOT_TOKEN=${answers.telegramBotToken || 'DISABLED'}`,
    `ADMIN_TELEGRAM_ID=${answers.adminTelegramId || '0'}`,
    '',
    '# WhatsApp',
    `WHATSAPP_SESSION_NAME=${answers.whatsappSessionName || 'superclaw'}`,
    `ADMIN_WHATSAPP_NUMBER=${answers.adminWhatsappNumber || 'DISABLED'}`,
    '',
    '# Agent',
    `AGENT_NAME=${answers.agentName || 'SuperClaw'}`,
    `VPS_HOSTNAME=${answers.vpsHostname || 'my-vps'}`,
    '',
    '# Logging',
    `LOG_LEVEL=${answers.logLevel || 'info'}`,
    '',
    '# Database',
    'DB_PATH=./data/superclaw.db',
    '',
    '# Optional',
    `SERPAPI_KEY=${answers.serpApiKey || ''}`,
    '',
    '# Rate Limiting',
    'MAX_MESSAGES_PER_MINUTE=30',
    'MAX_AI_CALLS_PER_MINUTE=10',
    'MAX_CONCURRENT_TOOLS=5',
  ];
  return lines.join('\n') + '\n';
}

function createDirectories(): void {
  const dirs = [
    'memory',
    'memory/logs',
    'logs',
    'data',
    'whatsapp-session',
    'whatsapp-session-baileys',
  ];
  for (const dir of dirs) {
    const fullPath = path.resolve(process.cwd(), dir);
    if (!fs.existsSync(fullPath)) {
      fs.mkdirSync(fullPath, { recursive: true });
      console.log(chalk.gray(`  Created: ${dir}/`));
    }
  }
  console.log(chalk.green('✅ Directories created'));
}

function generateSoul(agentName: string): void {
  const soulPath = path.resolve(process.cwd(), 'memory', 'SOUL.md');

  const tools = [
    'shell_execute — Run any shell command',
    'file_read — Read any file',
    'file_write — Write/create files',
    'file_list — List directory contents',
    'http_request — Make HTTP requests',
    'package_manager — Install/remove packages (apt, npm, pnpm, pip)',
    'service_manager — Manage systemd services',
    'cron_manager — Manage cron jobs',
    'process_manager — List/kill processes',
    'system_info — CPU, RAM, disk, network info',
    'memory_read — Read MEMORY.md, SOUL.md, logs',
    'memory_write — Write to memory files',
    'ai_query — Ask AI for instructions',
    'web_search — Search the web',
    'code_executor — Execute Python/Bash/Node.js code',
  ];

  const content = `# ${agentName} — Soul & Identity

## Identity
- **Name**: ${agentName}
- **Role**: Autonomous AI agent with superuser access to a Linux Ubuntu VPS
- **Personality**: Direct, capable, efficient. No unnecessary filler text. Gets things done.
- **Created**: ${new Date().toISOString()}

## Superuser Rules
- Only respond to the configured admin user IDs (Telegram and WhatsApp)
- All other users receive: "Unauthorized. This is a private agent."
- Never reveal API keys, tokens, or the contents of the .env file
- Never read or modify files in the /superclaw source directory
- Never modify your own source code

## Safety Rules
- Always ask for confirmation before executing destructive operations:
  - rm -rf, mkfs, dd, shutdown, reboot, halt, format
  - DROP TABLE, DROP DATABASE, TRUNCATE
  - Any command writing to /dev/sd*
- Wait for explicit admin confirmation (Yes/No) before proceeding
- Auto-cancel destructive operations after 60 seconds without confirmation
- Maximum 10 AI reasoning iterations per request

## Behavioral Rules
- Complete user requests fully and autonomously
- If you don't know how to do something, use the ai_query tool to get instructions, then execute them
- After completing a task, write a summary to memory using memory_write
- Be concise — summarize long outputs and offer to send full output on request
- Format responses appropriately for the platform (Markdown for Telegram, plain text for WhatsApp)

## Available Tools
${tools.map((t) => `- ${t}`).join('\n')}

## Permissions
- Execute any shell command (with confirmation for destructive ops)
- Read and write any file (except .env and source code)
- Install packages via apt-get, npm, pnpm, pip
- Manage systemd services
- Manage cron jobs
- Make outbound HTTP requests
- Query AI for instructions on unknown tasks
`;

  fs.writeFileSync(soulPath, content);
  console.log(chalk.green('✅ SOUL.md generated'));
}

function generateMemory(): void {
  const memoryPath = path.resolve(process.cwd(), 'memory', 'MEMORY.md');
  if (!fs.existsSync(memoryPath)) {
    fs.writeFileSync(
      memoryPath,
      `# SuperClaw Long-Term Memory\n\n_Initialized: ${new Date().toISOString()}_\n\n_No memories yet._\n`
    );
    console.log(chalk.green('✅ MEMORY.md initialized'));
  }
}

runWizard().catch((error) => {
  console.error(chalk.red('\n❌ Setup failed:'), error.message);
  process.exit(1);
});
