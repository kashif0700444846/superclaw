import inquirer from 'inquirer';
import chalk from 'chalk';
import fs from 'fs';
import path from 'path';
import { execSync, spawn } from 'child_process';
import { SuperclawConfig } from '../types/SuperclawConfig';

// Project root: compiled to dist/setup/wizard.js, so ../../ is the project root
const projectDir = path.join(__dirname, '../..');

function sanitizeEnvValue(value: string): string {
  if (!value) return '';
  // Remove surrounding quotes (single or double)
  return value.replace(/^["']|["']$/g, '').trim();
}

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
  browserAutomate: 80,
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
  if (tools.includes('browser_automate')) ram += RAM.browserAutomate;
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

// Detect if running on Termux
function isTermux(): boolean {
  return !!(
    process.env.TERMUX_VERSION ||
    process.env.PREFIX?.includes('termux') ||
    process.cwd().includes('/data/data/com.termux')
  );
}

// Auto-detect Chromium path for Termux
function detectChromiumPath(): string | undefined {
  const possiblePaths = [
    process.env.PREFIX + '/bin/chromium',
    process.env.PREFIX + '/bin/chromium-browser',
    '/data/data/com.termux/files/usr/bin/chromium',
    '/data/data/com.termux/files/usr/bin/chromium-browser',
  ];
  
  for (const p of possiblePaths) {
    if (fs.existsSync(p)) {
      return p;
    }
  }
  return undefined;
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

// Browser-like User-Agent to avoid Cloudflare WAF blocking OpenAI SDK requests.
// The OpenAI SDK's default User-Agent (e.g. "OpenAI/v1 openai-node/...") is
// blocked by Cloudflare WAF rules on custom proxy endpoints.  Overriding it
// with a real browser UA bypasses the block without affecting functionality.
const BROWSER_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
  'Accept': 'application/json',
  'Accept-Language': 'en-US,en;q=0.9',
};

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
      defaultHeaders: BROWSER_HEADERS,
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
    const client = new OpenAI({
      baseURL,
      apiKey: apiKey || 'none',
      defaultHeaders: BROWSER_HEADERS,
    });
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

  const runningOnTermux = isTermux();
  const chromiumPath = runningOnTermux ? detectChromiumPath() : undefined;
  let termuxConfig: { chromiumPath?: string } = {};
  
  if (runningOnTermux) {
    console.log(chalk.green('📱 Termux environment detected!\n'));
    if (chromiumPath) {
      console.log(chalk.green(`✓ Chromium found at: ${chromiumPath}\n`));
    }
  }

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
        {
          name: runningOnTermux 
            ? `browser_automate  ${chalk.green('(✓ Chromium ready — +80 MB)')}`
            : `browser_automate  ${chalk.yellow('(Playwright required — +80 MB)')}`,
          value: 'browser_automate',
          checked: runningOnTermux && !!chromiumPath,
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

  // Sanitize API key answers
  if (apiAnswers.openaiApiKey) apiAnswers.openaiApiKey = sanitizeEnvValue(apiAnswers.openaiApiKey);
  if (apiAnswers.anthropicApiKey) apiAnswers.anthropicApiKey = sanitizeEnvValue(apiAnswers.anthropicApiKey);
  if (apiAnswers.groqApiKey) apiAnswers.groqApiKey = sanitizeEnvValue(apiAnswers.groqApiKey);

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

    customAiBaseUrl = sanitizeEnvValue(urlAndKeyDetails.customBaseUrl);
    customAiApiKey = sanitizeEnvValue(urlAndKeyDetails.customApiKey);

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
          customAiBaseUrl = sanitizeEnvValue(retryUrlAndKey.customBaseUrl);
          customAiApiKey = sanitizeEnvValue(retryUrlAndKey.customApiKey);

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
    apiAnswers.customAiBaseUrl = sanitizeEnvValue(customAiBaseUrl);
    apiAnswers.customAiModel = sanitizeEnvValue(customAiModel);
    apiAnswers.customAiApiKey = sanitizeEnvValue(customAiApiKey);
  }

  // ── STEP 4b: AI Failover Configuration (Optional) ──────
  console.log(chalk.bold.cyan('\n🔄 AI Failover Configuration (Optional)\n'));
  console.log(chalk.gray('Configure fallback AI providers for automatic failover.\n'));

  const { configureFallback } = await inquirer.prompt<{ configureFallback: boolean }>([
    {
      type: 'confirm',
      name: 'configureFallback',
      message: 'Configure fallback AI providers for automatic failover?',
      default: false,
    },
  ]);

  let fallbackProvider = '';
  let fallbackModel = '';
  let fallbackApiKey = '';

  if (configureFallback) {
    const fallbackAnswers = await inquirer.prompt<{
      fallbackProvider: string;
      fallbackModel: string;
      fallbackApiKey: string;
    }>([
      {
        type: 'list',
        name: 'fallbackProvider',
        message: 'Fallback provider 1:',
        choices: [
          { name: 'OpenAI', value: 'openai' },
          { name: 'Anthropic', value: 'anthropic' },
          { name: 'Groq', value: 'groq' },
          { name: 'Ollama', value: 'ollama' },
          { name: 'None', value: '' },
        ],
        default: 'groq',
      },
      {
        type: 'input',
        name: 'fallbackModel',
        message: 'Fallback model 1:',
        default: (answers: any) => getDefaultModel(answers.fallbackProvider || 'groq'),
        when: (answers: any) => !!answers.fallbackProvider,
      },
      {
        type: 'password',
        name: 'fallbackApiKey',
        message: 'Fallback API key 1 (leave empty for Ollama/no-auth):',
        default: '',
        when: (answers: any) => !!answers.fallbackProvider && answers.fallbackProvider !== 'ollama',
      },
    ]);

    fallbackProvider = sanitizeEnvValue(fallbackAnswers.fallbackProvider || '');
    fallbackModel    = sanitizeEnvValue(fallbackAnswers.fallbackModel    || '');
    fallbackApiKey   = sanitizeEnvValue(fallbackAnswers.fallbackApiKey   || '');

    if (fallbackProvider) {
      console.log(chalk.green(`  ✅ Fallback configured: ${fallbackProvider} / ${fallbackModel || getDefaultModel(fallbackProvider)}`));
    }
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

  // Sanitize credential answers
  if (credAnswers.telegramBotToken) credAnswers.telegramBotToken = sanitizeEnvValue(credAnswers.telegramBotToken);
  if (credAnswers.adminTelegramId) credAnswers.adminTelegramId = sanitizeEnvValue(credAnswers.adminTelegramId);
  if (credAnswers.adminWhatsappNumber) credAnswers.adminWhatsappNumber = sanitizeEnvValue(credAnswers.adminWhatsappNumber);

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

  // Sanitize agent answers
  if (agentAnswers.agentName) agentAnswers.agentName = sanitizeEnvValue(agentAnswers.agentName);
  if (agentAnswers.serpApiKey) agentAnswers.serpApiKey = sanitizeEnvValue(agentAnswers.serpApiKey);

  // ── STEP 7 prep: Build enabled tools list ──────────────
  const enabledTools = [
    'shell_execute', 'file_read', 'file_write', 'file_list',
    'http_request', 'cron_manager',
    'process_manager', 'system_info', 'memory_read', 'memory_write', 'ai_query',
    ...optionalTools,
  ];

  // Add platform-specific tools (disabled on Termux)
  if (!runningOnTermux) {
    enabledTools.push('package_manager', 'service_manager');
  }

  // ── STEP 6b: Android/Termux Configuration ──────────────
  let termuxApiInstalled = false;
  let runTermuxBootSetup = false;

  if (runningOnTermux) {
    console.log(chalk.bold.cyan('\n📱 Android/Termux Configuration\n'));
    console.log(chalk.gray('Configure Android-specific features for your device.\n'));

    // Auto-detect su availability for root default
    let suAvailable = false;
    try {
      execSync('which su', { stdio: 'ignore' });
      suAvailable = true;
    } catch {
      // su not available
    }

    const termuxAnswers = await inquirer.prompt<{
      installTermuxApi: boolean;
      enableRootShell: boolean;
      setupTermuxBoot: boolean;
      enableAndroidInfo: boolean;
    }>([
      {
        type: 'confirm',
        name: 'installTermuxApi',
        message: 'Install termux-api package for Android device control?',
        default: true,
      },
      {
        type: 'confirm',
        name: 'enableRootShell',
        message: `Enable root shell tool? (requires rooted device)${suAvailable ? chalk.green(' [su detected]') : chalk.gray(' [su not found]')}`,
        default: suAvailable,
      },
      {
        type: 'confirm',
        name: 'setupTermuxBoot',
        message: 'Set up Termux:Boot for auto-start on device reboot?',
        default: true,
      },
      {
        type: 'confirm',
        name: 'enableAndroidInfo',
        message: 'Enable Android device info tool?',
        default: true,
      },
    ]);

    // Install termux-api if requested
    if (termuxAnswers.installTermuxApi) {
      console.log(chalk.gray('\n  Installing termux-api package...'));
      try {
        execSync('pkg install -y termux-api', { stdio: 'inherit' });
        termuxApiInstalled = true;
        console.log(chalk.green('  ✅ termux-api installed'));
      } catch (err: any) {
        console.log(chalk.yellow(`  ⚠️  termux-api install failed: ${err.message}`));
      }
    }

    // Add root_shell tool if enabled
    if (termuxAnswers.enableRootShell) {
      if (!enabledTools.includes('root_shell')) {
        enabledTools.push('root_shell');
      }
      console.log(chalk.green('  ✅ root_shell tool enabled'));
    }

    // Add android_info tool if enabled
    if (termuxAnswers.enableAndroidInfo) {
      if (!enabledTools.includes('android_info')) {
        enabledTools.push('android_info');
      }
      console.log(chalk.green('  ✅ android_info tool enabled'));
    }

    // Schedule Termux:Boot setup for after wizard completes
    runTermuxBootSetup = termuxAnswers.setupTermuxBoot;
  }

  // ── STEP 7: Final Summary ───────────────────────────────
  const disabledTools = ['web_search', 'code_executor', 'browser_automate'].filter(
    (t) => !optionalTools.includes(t)
  );
  
  // Mark Termux-incompatible tools as disabled
  if (runningOnTermux) {
    disabledTools.push('package_manager', 'service_manager');
  }
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
    fallbackProvider,
    fallbackModel,
    fallbackApiKey,
  };

  // Write .env (with Termux-specific config if applicable)
  const envContent = buildEnvContent(allAnswers, platforms, termuxConfig);
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

  // Run Termux:Boot setup if requested
  if (runningOnTermux && runTermuxBootSetup) {
    console.log(chalk.gray('\n  Setting up Termux:Boot auto-start...'));
    try {
      execSync('bash termux-boot-setup.sh', { stdio: 'inherit' });
      console.log(chalk.green('✅ Termux:Boot configured'));
    } catch (err: any) {
      console.log(chalk.yellow(`⚠️  Termux:Boot setup failed: ${err.message}`));
      console.log(chalk.gray('  Run manually: bash termux-boot-setup.sh'));
    }
  }

  // Final instructions
  console.log(chalk.cyan('\n╔══════════════════════════════════════════╗'));
  console.log(chalk.cyan('║           Setup Complete! 🎉             ║'));
  console.log(chalk.cyan('╚══════════════════════════════════════════╝\n'));

  if (platforms.includes('whatsapp')) {
    console.log(chalk.gray('  ℹ️  On first WhatsApp run, scan the QR code in the terminal.\n'));
  }

  // ── Interactive post-setup launch ──────────────────────
  const { startNow } = await inquirer.prompt<{ startNow: boolean }>([{
    type: 'confirm',
    name: 'startNow',
    message: 'Would you like to start SuperClaw now?',
    default: true,
  }]);

  if (startNow) {
    // Check if PM2 is available (skip on Termux — PM2 is rarely used there)
    let pm2Available = false;
    if (!runningOnTermux) {
      try {
        execSync('pm2 --version', { stdio: 'pipe' });
        pm2Available = true;
      } catch { /* PM2 not installed */ }
    }

    let startMethod: string;

    if (pm2Available) {
      const { method } = await inquirer.prompt<{ method: string }>([{
        type: 'list',
        name: 'method',
        message: 'How would you like to start SuperClaw?',
        choices: [
          { name: '🚀 PM2 (recommended for production — runs in background)', value: 'pm2' },
          { name: '▶️  Direct (runs in foreground — good for testing)', value: 'direct' },
          { name: '❌ Skip — I\'ll start it manually', value: 'skip' },
        ],
      }]);
      startMethod = method;
    } else {
      const { method } = await inquirer.prompt<{ method: string }>([{
        type: 'list',
        name: 'method',
        message: 'How would you like to start SuperClaw?',
        choices: [
          { name: '▶️  Direct (runs in foreground)', value: 'direct' },
          { name: '❌ Skip — I\'ll start it manually', value: 'skip' },
        ],
      }]);
      startMethod = method;
    }

    if (startMethod === 'pm2') {
      console.log('\n🚀 Starting SuperClaw with PM2...');
      try {
        execSync('pm2 start ecosystem.config.js', { stdio: 'inherit', cwd: projectDir });
        execSync('pm2 save', { stdio: 'inherit', cwd: projectDir });
        console.log('\n✅ SuperClaw is running! Use these commands:');
        console.log('   pm2 logs superclaw    — view logs');
        console.log('   pm2 restart superclaw — restart');
        console.log('   pm2 stop superclaw    — stop');
        console.log('   superclaw --help      — CLI help');
      } catch (e: any) {
        console.error('Failed to start with PM2:', e.message);
        console.log('Try manually: pm2 start ecosystem.config.js');
      }
    } else if (startMethod === 'direct') {
      console.log('\n▶️  Starting SuperClaw directly...');
      console.log('Press Ctrl+C to stop.\n');
      const child = spawn('node', ['dist/index.js'], { stdio: 'inherit', cwd: projectDir });
      child.on('exit', (code: number | null) => process.exit(code ?? 0));
      return; // Don't print anything after this — child owns the terminal
    } else {
      console.log('\n📋 To start SuperClaw manually:');
      if (runningOnTermux) {
        console.log('   Direct: pnpm start');
      } else {
        console.log('   PM2:    pm2 start ecosystem.config.js');
        console.log('   Direct: node dist/index.js');
        console.log('   CLI:    superclaw --help');
      }
    }
  } else {
    console.log('\n📋 To start SuperClaw later:');
    if (runningOnTermux) {
      console.log('   Direct: pnpm start');
    } else {
      console.log('   PM2:    pm2 start ecosystem.config.js');
      console.log('   Direct: node dist/index.js');
      console.log('   CLI:    superclaw --help');
    }
  }

  // ── Admin tip ───────────────────────────────────────────
  console.log(chalk.cyan('\n💡 Tip: To add more admin users later, run: ') + chalk.yellow('superclaw admin add'));
  console.log(chalk.gray('        Or get a user\'s Telegram ID from @userinfobot'));
}

function buildEnvContent(
  answers: any,
  platforms: string[],
  termuxConfig?: { chromiumPath?: string }
): string {
  const lines = [
    '# SuperClaw Configuration',
    `# Generated: ${new Date().toISOString()}`,
    '',
    '# AI Provider',
    `AI_PROVIDER=${sanitizeEnvValue(answers.aiProvider || 'openai')}`,
    `AI_MODEL=${sanitizeEnvValue(answers.aiModel || 'gpt-4o')}`,
    '',
    '# API Keys',
    `OPENAI_API_KEY=${sanitizeEnvValue(answers.openaiApiKey || '')}`,
    `ANTHROPIC_API_KEY=${sanitizeEnvValue(answers.anthropicApiKey || '')}`,
    `GROQ_API_KEY=${sanitizeEnvValue(answers.groqApiKey || '')}`,
    `OLLAMA_BASE_URL=${sanitizeEnvValue(answers.ollamaBaseUrl || 'http://localhost:11434')}`,
    '',
    '# Custom OpenAI-compatible provider (used when AI_PROVIDER=custom)',
    `CUSTOM_AI_BASE_URL=${sanitizeEnvValue(answers.customAiBaseUrl || '')}`,
    `CUSTOM_AI_MODEL=${sanitizeEnvValue(answers.customAiModel || '')}`,
    `CUSTOM_AI_API_KEY=${sanitizeEnvValue(answers.customAiApiKey || '')}`,
    '',
    '# Telegram',
    `TELEGRAM_BOT_TOKEN=${sanitizeEnvValue(answers.telegramBotToken || 'DISABLED')}`,
    `ADMIN_TELEGRAM_ID=${sanitizeEnvValue(answers.adminTelegramId || '0')}`,
    '',
    '# WhatsApp',
    `WHATSAPP_SESSION_NAME=${sanitizeEnvValue(answers.whatsappSessionName || 'superclaw')}`,
    `ADMIN_WHATSAPP_NUMBER=${sanitizeEnvValue(answers.adminWhatsappNumber || 'DISABLED')}`,
    '',
    '# Agent',
    `AGENT_NAME=${sanitizeEnvValue(answers.agentName || 'SuperClaw')}`,
    `VPS_HOSTNAME=${sanitizeEnvValue(answers.vpsHostname || 'my-vps')}`,
    '',
    '# Logging',
    `LOG_LEVEL=${sanitizeEnvValue(answers.logLevel || 'info')}`,
    '',
    '# Database',
    'DB_PATH=./data/superclaw.db',
    '',
    '# Optional',
    `SERPAPI_KEY=${sanitizeEnvValue(answers.serpApiKey || '')}`,
    '',
  ];

  // Add Termux-specific Chromium configuration
  if (termuxConfig?.chromiumPath) {
    lines.push(
      '# Termux Browser Automation (auto-detected)',
      `CHROMIUM_PATH=${termuxConfig.chromiumPath}`,
      'PLAYWRIGHT_BROWSERS_PATH=0',
      ''
    );
  }

  // Add fallback AI configuration
  lines.push(
    '# AI Failover',
    `FALLBACK_AI_PROVIDER=${sanitizeEnvValue(answers.fallbackProvider || '')}`,
    `FALLBACK_AI_MODEL=${sanitizeEnvValue(answers.fallbackModel || '')}`,
    'AI_MAX_RETRIES=3',
    'AI_RETRY_DELAY_MS=1000',
    ''
  );

  lines.push(
    '# Rate Limiting',
    'MAX_MESSAGES_PER_MINUTE=30',
    'MAX_AI_CALLS_PER_MINUTE=10',
    'MAX_CONCURRENT_TOOLS=5'
  );

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
    'browser_automate — Browser automation (screenshots, scraping, forms)',
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
