#!/usr/bin/env node
/**
 * SuperClaw Doctor — Health Check CLI
 * Run: npx tsx src/doctor.ts
 * Inspired by OpenClaw's `openclaw doctor` command
 */

import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import https from 'https';
import http from 'http';

// ── Load .env if dotenv is available ────────────────────────────────────────
const envPath = path.resolve(process.cwd(), '.env');
if (fs.existsSync(envPath)) {
  try {
    // dotenv is a dependency — safe to require
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    require('dotenv').config({ path: envPath });
  } catch {
    // dotenv not available — continue without it
  }
}

// ── Types ────────────────────────────────────────────────────────────────────
type CheckStatus = 'pass' | 'warn' | 'fail';

interface CheckResult {
  label: string;
  status: CheckStatus;
  message: string;
}

// ── Helpers ──────────────────────────────────────────────────────────────────
const RESET  = '\x1b[0m';
const GREEN  = '\x1b[32m';
const YELLOW = '\x1b[33m';
const RED    = '\x1b[31m';
const CYAN   = '\x1b[36m';
const BOLD   = '\x1b[1m';
const DIM    = '\x1b[2m';

function icon(status: CheckStatus): string {
  switch (status) {
    case 'pass': return `${GREEN}✅${RESET}`;
    case 'warn': return `${YELLOW}⚠️ ${RESET}`;
    case 'fail': return `${RED}❌${RESET}`;
  }
}

function pass(label: string, message: string): CheckResult {
  return { label, status: 'pass', message };
}

function warn(label: string, message: string): CheckResult {
  return { label, status: 'warn', message };
}

function fail(label: string, message: string): CheckResult {
  return { label, status: 'fail', message };
}

function printSection(title: string): void {
  console.log(`\n${BOLD}${title}${RESET}`);
}

function printResult(result: CheckResult): void {
  const ico = icon(result.status);
  console.log(`  ${ico} ${result.message}`);
}

function execCheck(cmd: string): string {
  return execSync(cmd, { stdio: 'pipe', timeout: 5000 }).toString().trim();
}

/**
 * Minimal HTTP/HTTPS GET — returns { statusCode, body } or throws.
 */
function httpGet(url: string, headers: Record<string, string> = {}): Promise<{ statusCode: number; body: string }> {
  return new Promise((resolve, reject) => {
    const lib = url.startsWith('https') ? https : http;
    const req = lib.get(url, { headers, timeout: 8000 }, (res) => {
      let body = '';
      res.on('data', (chunk) => { body += chunk; });
      res.on('end', () => resolve({ statusCode: res.statusCode ?? 0, body }));
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('Request timed out')); });
  });
}

// ── Check implementations ────────────────────────────────────────────────────

// 1. Node.js version
function checkNodeVersion(): CheckResult {
  const version = process.version; // e.g. "v22.0.0"
  const major = parseInt(version.slice(1).split('.')[0], 10);
  if (major >= 20) {
    return pass('node', `Node.js ${version} (>= 20 required)`);
  }
  return fail('node', `Node.js ${version} — requires >= 20.0.0`);
}

// 2. pnpm available
function checkPnpm(): CheckResult {
  try {
    const version = execCheck('pnpm --version');
    return pass('pnpm', `pnpm ${version}`);
  } catch {
    return warn('pnpm', 'pnpm not found (install: npm install -g pnpm)');
  }
}

// 3. TypeScript compiled
function checkDistExists(): CheckResult {
  const distPath = path.resolve(process.cwd(), 'dist', 'index.js');
  if (fs.existsSync(distPath)) {
    return pass('dist', 'TypeScript compiled (dist/index.js exists)');
  }
  return warn('dist', 'dist/index.js not found — run: pnpm build');
}

// 4. .env file
function checkEnvFile(): CheckResult {
  if (fs.existsSync(envPath)) {
    return pass('.env', '.env file found');
  }
  return warn('.env', '.env file not found (copy .env.example to .env)');
}

// 5. superclaw.config.json
function checkSuperclawConfig(): CheckResult {
  const configPath = path.resolve(process.cwd(), 'superclaw.config.json');
  if (!fs.existsSync(configPath)) {
    return warn('config', 'superclaw.config.json not found (run: pnpm setup)');
  }
  try {
    const raw = fs.readFileSync(configPath, 'utf-8');
    JSON.parse(raw);
    return pass('config', 'superclaw.config.json valid');
  } catch {
    return fail('config', 'superclaw.config.json is invalid JSON');
  }
}

// 6. AI provider configured
function checkAiProvider(): CheckResult {
  const provider = process.env.AI_PROVIDER;
  if (!provider) {
    return fail('ai_provider', 'AI_PROVIDER not set in .env');
  }
  const valid = ['openai', 'anthropic', 'groq', 'ollama', 'custom'];
  if (!valid.includes(provider)) {
    return fail('ai_provider', `AI_PROVIDER="${provider}" is invalid (must be: ${valid.join(', ')})`);
  }
  return pass('ai_provider', `Provider: ${provider}`);
}

// 7. API key present
function checkApiKey(): CheckResult {
  const provider = process.env.AI_PROVIDER || 'openai';
  const keyMap: Record<string, string> = {
    openai:    'OPENAI_API_KEY',
    anthropic: 'ANTHROPIC_API_KEY',
    groq:      'GROQ_API_KEY',
    ollama:    '', // no key needed
    custom:    'CUSTOM_AI_API_KEY',
  };
  const keyName = keyMap[provider];
  if (!keyName) {
    // Ollama — check base URL instead
    const ollamaUrl = process.env.OLLAMA_BASE_URL || 'http://localhost:11434';
    return pass('api_key', `Ollama — no API key needed (base URL: ${ollamaUrl})`);
  }
  const keyValue = process.env[keyName];
  if (keyValue && keyValue.length > 4) {
    return pass('api_key', `API key: ${keyName} set`);
  }
  return fail('api_key', `${keyName} is not set`);
}

// 8. AI connectivity
async function checkAiConnectivity(): Promise<CheckResult> {
  const provider = process.env.AI_PROVIDER || 'openai';
  const model    = process.env.AI_MODEL || 'gpt-4o';

  try {
    if (provider === 'openai') {
      const apiKey = process.env.OPENAI_API_KEY || '';
      if (!apiKey) return warn('ai_connect', 'Skipped — OPENAI_API_KEY not set');
      const res = await httpGet('https://api.openai.com/v1/models', {
        Authorization: `Bearer ${apiKey}`,
      });
      if (res.statusCode === 200) {
        return pass('ai_connect', `AI connectivity: OK (${model})`);
      }
      const parsed = JSON.parse(res.body);
      return fail('ai_connect', `AI connectivity failed: ${parsed?.error?.message ?? res.statusCode}`);
    }

    if (provider === 'anthropic') {
      const apiKey = process.env.ANTHROPIC_API_KEY || '';
      if (!apiKey) return warn('ai_connect', 'Skipped — ANTHROPIC_API_KEY not set');
      const res = await httpGet('https://api.anthropic.com/v1/models', {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      });
      if (res.statusCode === 200) {
        return pass('ai_connect', `AI connectivity: OK (${model})`);
      }
      return fail('ai_connect', `AI connectivity failed: HTTP ${res.statusCode}`);
    }

    if (provider === 'groq') {
      const apiKey = process.env.GROQ_API_KEY || '';
      if (!apiKey) return warn('ai_connect', 'Skipped — GROQ_API_KEY not set');
      const res = await httpGet('https://api.groq.com/openai/v1/models', {
        Authorization: `Bearer ${apiKey}`,
      });
      if (res.statusCode === 200) {
        return pass('ai_connect', `AI connectivity: OK (${model})`);
      }
      return fail('ai_connect', `AI connectivity failed: HTTP ${res.statusCode}`);
    }

    if (provider === 'ollama') {
      const baseUrl = process.env.OLLAMA_BASE_URL || 'http://localhost:11434';
      const res = await httpGet(`${baseUrl}/api/tags`);
      if (res.statusCode === 200) {
        return pass('ai_connect', `AI connectivity: Ollama OK at ${baseUrl}`);
      }
      return fail('ai_connect', `Ollama not reachable at ${baseUrl} (HTTP ${res.statusCode})`);
    }

    if (provider === 'custom') {
      const baseUrl = process.env.CUSTOM_AI_BASE_URL || '';
      const apiKey  = process.env.CUSTOM_AI_API_KEY  || '';
      if (!baseUrl) return warn('ai_connect', 'Skipped — CUSTOM_AI_BASE_URL not set');
      const headers: Record<string, string> = {};
      if (apiKey) headers['Authorization'] = `Bearer ${apiKey}`;
      const res = await httpGet(`${baseUrl}/models`, headers);
      if (res.statusCode === 200) {
        return pass('ai_connect', `AI connectivity: Custom endpoint OK (${model})`);
      }
      return fail('ai_connect', `Custom AI endpoint failed: HTTP ${res.statusCode}`);
    }

    return warn('ai_connect', `Unknown provider "${provider}" — skipping connectivity check`);
  } catch (err: any) {
    return fail('ai_connect', `AI connectivity error: ${err.message}`);
  }
}

// 9. Telegram token
function checkTelegramToken(): CheckResult {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token || token === 'DISABLED') {
    return warn('telegram_token', 'TELEGRAM_BOT_TOKEN not set (WhatsApp-only setup?)');
  }
  return pass('telegram_token', 'Telegram token configured');
}

// 10. Telegram connectivity
async function checkTelegramConnectivity(): Promise<CheckResult> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token || token === 'DISABLED') {
    return warn('telegram_connect', 'Skipped — no Telegram token');
  }
  try {
    const res = await httpGet(`https://api.telegram.org/bot${token}/getMe`);
    if (res.statusCode === 200) {
      const parsed = JSON.parse(res.body);
      const username = parsed?.result?.username ?? 'unknown';
      return pass('telegram_connect', `Telegram connectivity: @${username}`);
    }
    const parsed = JSON.parse(res.body);
    return fail('telegram_connect', `Telegram API error: ${parsed?.description ?? res.statusCode}`);
  } catch (err: any) {
    return fail('telegram_connect', `Telegram connectivity error: ${err.message}`);
  }
}

// 11. SQLite database
function checkDatabase(): CheckResult {
  const dbPath = process.env.DB_PATH
    ? path.resolve(process.cwd(), process.env.DB_PATH)
    : path.resolve(process.cwd(), 'data', 'superclaw.db');
  if (fs.existsSync(dbPath)) {
    const stats = fs.statSync(dbPath);
    const kb = Math.round(stats.size / 1024);
    return pass('db', `SQLite database found (${kb} KB)`);
  }
  return warn('db', 'SQLite database not found (will be created on first run)');
}

// 12. Memory directory
function checkMemoryDir(): CheckResult {
  const memDir    = path.resolve(process.cwd(), 'memory');
  const memoryMd  = path.join(memDir, 'MEMORY.md');
  const soulMd    = path.join(memDir, 'SOUL.md');

  if (!fs.existsSync(memDir)) {
    return warn('memory', 'memory/ directory not found (run: pnpm setup)');
  }
  const missingFiles: string[] = [];
  if (!fs.existsSync(memoryMd)) missingFiles.push('MEMORY.md');
  if (!fs.existsSync(soulMd))   missingFiles.push('SOUL.md');

  if (missingFiles.length > 0) {
    return warn('memory', `memory/ exists but missing: ${missingFiles.join(', ')} (run: pnpm setup)`);
  }
  return pass('memory', 'Memory directory OK (MEMORY.md, SOUL.md present)');
}

// 13–16. Termux checks (only if in Termux)
function isTermux(): boolean {
  return !!(
    process.env.TERMUX_VERSION ||
    process.env.PREFIX?.includes('termux') ||
    process.cwd().includes('/data/data/com.termux')
  );
}

function checkTermuxEnvironment(): CheckResult {
  const version = process.env.TERMUX_VERSION || 'detected';
  return pass('termux', `Termux environment (version: ${version})`);
}

function checkTermuxApi(): CheckResult {
  try {
    execCheck('which termux-api');
    return pass('termux_api', 'termux-api package installed');
  } catch {
    return warn('termux_api', 'termux-api not found (install: pkg install termux-api)');
  }
}

function checkRootAccess(): CheckResult {
  try {
    execCheck('which su');
    return pass('root', 'Root access available (su found)');
  } catch {
    return warn('root', 'Root access not available (su not found)');
  }
}

function checkTermuxBoot(): CheckResult {
  const bootScript = path.resolve(
    process.env.HOME || '/data/data/com.termux/files/home',
    '.termux', 'boot', 'start-superclaw.sh'
  );
  if (fs.existsSync(bootScript)) {
    return pass('termux_boot', 'Termux:Boot script found (~/.termux/boot/start-superclaw.sh)');
  }
  return warn('termux_boot', 'Termux:Boot script not found (run: bash termux-boot-setup.sh)');
}

// 17. Git available
function checkGit(): CheckResult {
  try {
    const version = execCheck('git --version');
    // "git version 2.43.0" → extract version number
    const match = version.match(/(\d+\.\d+\.\d+)/);
    return pass('git', `git ${match ? match[1] : version}`);
  } catch {
    return warn('git', 'git not found (install: apt-get install git)');
  }
}

// 18. PM2 available
function checkPm2(): CheckResult {
  try {
    const version = execCheck('pm2 --version');
    return pass('pm2', `PM2 ${version.trim()}`);
  } catch {
    return warn('pm2', 'PM2 not found (install: npm install -g pm2)');
  }
}

// ── Main ─────────────────────────────────────────────────────────────────────
async function main(): Promise<void> {
  // Read version from package.json
  let version = '1.0.0';
  try {
    const pkgPath = path.resolve(process.cwd(), 'package.json');
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
    version = pkg.version ?? version;
  } catch {
    // ignore
  }

  console.log(`\n${CYAN}${BOLD}🦀 SuperClaw Doctor v${version}${RESET}`);
  console.log(`${DIM}${'='.repeat(40)}${RESET}`);

  const allResults: CheckResult[] = [];

  // ── Environment ────────────────────────────────────────
  printSection('Environment');
  const envChecks: CheckResult[] = [
    checkNodeVersion(),
    checkPnpm(),
    checkDistExists(),
    checkEnvFile(),
    checkSuperclawConfig(),
  ];
  envChecks.forEach((r) => { printResult(r); allResults.push(r); });

  // ── AI Provider ────────────────────────────────────────
  printSection('AI Provider');
  const aiProviderCheck  = checkAiProvider();
  const aiKeyCheck       = checkApiKey();
  const aiConnectCheck   = await checkAiConnectivity();
  const aiChecks = [aiProviderCheck, aiKeyCheck, aiConnectCheck];
  aiChecks.forEach((r) => { printResult(r); allResults.push(r); });

  // ── Platforms ──────────────────────────────────────────
  printSection('Platforms');
  const telegramTokenCheck   = checkTelegramToken();
  const telegramConnectCheck = await checkTelegramConnectivity();
  const platformChecks = [telegramTokenCheck, telegramConnectCheck];
  platformChecks.forEach((r) => { printResult(r); allResults.push(r); });

  // ── Database ───────────────────────────────────────────
  printSection('Database');
  const dbChecks: CheckResult[] = [
    checkDatabase(),
    checkMemoryDir(),
  ];
  dbChecks.forEach((r) => { printResult(r); allResults.push(r); });

  // ── Android/Termux (only if in Termux) ────────────────
  if (isTermux()) {
    printSection('Android/Termux');
    const termuxChecks: CheckResult[] = [
      checkTermuxEnvironment(),
      checkTermuxApi(),
      checkRootAccess(),
      checkTermuxBoot(),
    ];
    termuxChecks.forEach((r) => { printResult(r); allResults.push(r); });
  }

  // ── Tools ──────────────────────────────────────────────
  printSection('Tools');
  const toolChecks: CheckResult[] = [
    checkGit(),
    checkPm2(),
  ];
  toolChecks.forEach((r) => { printResult(r); allResults.push(r); });

  // ── Summary ────────────────────────────────────────────
  const warnings = allResults.filter((r) => r.status === 'warn').length;
  const errors   = allResults.filter((r) => r.status === 'fail').length;

  console.log(`\n${DIM}${'='.repeat(40)}${RESET}`);

  if (errors === 0 && warnings === 0) {
    console.log(`${GREEN}${BOLD}Result: All checks passed! 🎉${RESET}`);
  } else {
    const parts: string[] = [];
    if (warnings > 0) parts.push(`${YELLOW}${warnings} warning${warnings !== 1 ? 's' : ''}${RESET}`);
    if (errors   > 0) parts.push(`${RED}${errors} error${errors !== 1 ? 's' : ''}${RESET}`);
    console.log(`${BOLD}Result: ${parts.join(', ')}${RESET}`);
  }

  if (errors > 0 || warnings > 0) {
    console.log(`${DIM}Run 'pnpm setup' to fix configuration issues.${RESET}`);
  }

  console.log('');

  process.exit(errors > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error(`\n${RED}Doctor failed unexpectedly: ${err.message}${RESET}`);
  process.exit(1);
});
