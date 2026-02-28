#!/usr/bin/env node
'use strict';

// ─────────────────────────────────────────────────────────────────────────────
// SuperClaw Quickstart — Zero-dependency Web UI Setup
// Uses ONLY Node.js built-ins: http, fs, path, child_process, os, crypto
// ─────────────────────────────────────────────────────────────────────────────

const http         = require('http');
const https        = require('https');
const fs           = require('fs');
const path         = require('path');
const { execSync, spawn } = require('child_process');
const os           = require('os');
const readline     = require('readline');

const projectDir = __dirname;

// ── ANSI color codes (no chalk dependency) ────────────────────────────────
const c = {
  reset:   '\x1b[0m',
  bright:  '\x1b[1m',
  dim:     '\x1b[2m',
  green:   '\x1b[32m',
  yellow:  '\x1b[33m',
  blue:    '\x1b[34m',
  cyan:    '\x1b[36m',
  red:     '\x1b[31m',
  magenta: '\x1b[35m',
  white:   '\x1b[37m',
};

function bold(s)   { return c.bright  + s + c.reset; }
function green(s)  { return c.green   + s + c.reset; }
function yellow(s) { return c.yellow  + s + c.reset; }
function cyan(s)   { return c.cyan    + s + c.reset; }
function red(s)    { return c.red     + s + c.reset; }
function dim(s)    { return c.dim     + s + c.reset; }

// ── Environment detection ─────────────────────────────────────────────────
function detectEnvironment() {
  function cmdExists(cmd) {
    try {
      execSync(
        process.platform === 'win32'
          ? `where ${cmd} 2>nul`
          : `which ${cmd} 2>/dev/null`,
        { stdio: 'pipe' }
      );
      return true;
    } catch { return false; }
  }

  function dirExists(p)  { try { return fs.statSync(p).isDirectory(); } catch { return false; } }
  function fileExists(p) { try { return fs.statSync(p).isFile();      } catch { return false; } }

  const platform  = process.platform;
  const isWindows = platform === 'win32';
  const isLinux   = platform === 'linux';
  const isMac     = platform === 'darwin';

  const isTermux = !!process.env.TERMUX_VERSION || dirExists('/data/data/com.termux');

  const isDocker = fileExists('/.dockerenv') || (() => {
    try { return fs.readFileSync('/proc/1/cgroup', 'utf8').includes('docker'); } catch { return false; }
  })();

  const isRoot = !isWindows && typeof process.getuid === 'function' && process.getuid() === 0;

  const hasAaPanel    = dirExists('/www/server/panel') || dirExists('/www/server/nginx');
  const hasCpanel     = dirExists('/usr/local/cpanel');
  const hasPleskPanel = dirExists('/usr/local/psa');
  const hasNginx      = cmdExists('nginx');
  const hasApache     = cmdExists('apache2') || cmdExists('httpd');
  const hasPm2        = cmdExists('pm2');
  const hasSystemd    = isLinux && !isTermux && cmdExists('systemctl');
  const hasPnpm       = cmdExists('pnpm');
  const hasNpm        = cmdExists('npm');
  const hasYarn       = cmdExists('yarn');

  let envType;
  if      (isTermux)                 envType = 'termux';
  else if (isDocker)                 envType = 'docker';
  else if (isWindows)                envType = 'windows';
  else if (isMac)                    envType = 'macos';
  else if (isLinux && hasAaPanel)    envType = 'vps-aapanel';
  else if (isLinux && hasCpanel)     envType = 'vps-cpanel';
  else if (isLinux && hasPleskPanel) envType = 'vps-plesk';
  else if (isLinux)                  envType = 'vps-linux';
  else                               envType = 'unknown';

  return {
    envType, platform, isTermux, isDocker, isLinux, isMac, isWindows,
    isRoot, hasAaPanel, hasCpanel, hasPleskPanel, hasNginx, hasApache,
    hasPm2, hasSystemd, hasPnpm, hasNpm, hasYarn,
    packageManager: hasPnpm ? 'pnpm' : hasYarn ? 'yarn' : 'npm',
  };
}

function envLabel(env) {
  switch (env.envType) {
    case 'termux':      return 'Android (Termux)';
    case 'docker':      return 'Docker Container';
    case 'windows':     return 'Windows';
    case 'macos':       return 'macOS';
    case 'vps-aapanel': return 'VPS Linux (aaPanel)';
    case 'vps-cpanel':  return 'VPS Linux (cPanel)';
    case 'vps-plesk':   return 'VPS Linux (Plesk)';
    case 'vps-linux':   return 'VPS Linux';
    default:            return 'Unknown';
  }
}

// ── Public IP detection ───────────────────────────────────────────────────
async function getPublicIP() {
  function fetchIP(url) {
    return new Promise((resolve, reject) => {
      const mod = url.startsWith('https') ? https : http;
      const req = mod.get(url, { timeout: 3000 }, (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => resolve(data.trim()));
      });
      req.on('error', reject);
      req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
    });
  }

  for (const url of ['https://api.ipify.org', 'https://ifconfig.me/ip', 'https://icanhazip.com']) {
    try {
      const ip = await fetchIP(url);
      if (/^\d+\.\d+\.\d+\.\d+$/.test(ip)) return ip;
    } catch { /* try next */ }
  }

  const interfaces = os.networkInterfaces();
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name]) {
      if (iface.family === 'IPv4' && !iface.internal) return iface.address;
    }
  }
  return 'localhost';
}

// ── Find a free port starting from `start` ────────────────────────────────
function findFreePort(start) {
  return new Promise((resolve) => {
    const server = http.createServer();
    server.listen(start, () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
    server.on('error', () => resolve(findFreePort(start + 1)));
  });
}

// ── Parse request body ────────────────────────────────────────────────────
function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => { body += chunk; if (body.length > 1e6) req.destroy(); });
    req.on('end', () => {
      try { resolve(JSON.parse(body || '{}')); }
      catch { resolve({}); }
    });
    req.on('error', reject);
  });
}

// ── SSE helpers ───────────────────────────────────────────────────────────
const sseClients = { install: new Set(), build: new Set(), app: new Set() };

function sseWrite(channel, data) {
  const msg = `data: ${JSON.stringify(data)}\n\n`;
  for (const res of sseClients[channel]) {
    try { res.write(msg); } catch { sseClients[channel].delete(res); }
  }
}

function sseEnd(channel, data) {
  sseWrite(channel, { ...data, done: true });
  for (const res of sseClients[channel]) {
    try { res.end(); } catch { /* ignore */ }
  }
  sseClients[channel].clear();
}

// ── Spawn a command and stream output to an SSE channel ──────────────────
function spawnStreamed(channel, cmd, args, opts) {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, { cwd: projectDir, ...opts });

    child.stdout && child.stdout.on('data', d => sseWrite(channel, { line: d.toString() }));
    child.stderr && child.stderr.on('data', d => sseWrite(channel, { line: d.toString() }));

    child.on('error', (err) => {
      sseEnd(channel, { error: err.message });
      resolve({ code: 1, error: err.message });
    });

    child.on('close', (code) => {
      if (code === 0) {
        sseEnd(channel, { success: true });
      } else {
        sseEnd(channel, { error: `Process exited with code ${code}` });
      }
      resolve({ code });
    });
  });
}

// ── State ─────────────────────────────────────────────────────────────────
let appProcess = null;
let terminalModeRequested = false;

function getStatus() {
  const nodeVersion = process.version;
  const pnpmInstalled = (() => {
    try { execSync('pnpm --version', { stdio: 'pipe' }); return true; } catch { return false; }
  })();
  const built      = fs.existsSync(path.join(projectDir, 'dist', 'index.js'));
  const configured = fs.existsSync(path.join(projectDir, '.env'));
  const running    = appProcess !== null && !appProcess.killed;
  return { nodeVersion, pnpmInstalled, built, configured, running };
}

// ── Embedded HTML ─────────────────────────────────────────────────────────
function buildHTML(env, ip, port) {
  const label = envLabel(env);
  const envJson = JSON.stringify({ envType: env.envType, label, ip, port });

  return /* html */`<!DOCTYPE html>
<html lang="en" class="dark">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>SuperClaw Setup</title>
  <script src="https://cdn.tailwindcss.com"></script>
  <script>
    tailwind.config = {
      darkMode: 'class',
      theme: {
        extend: {
          colors: {
            brand: { DEFAULT: '#10b981', dark: '#059669' },
          },
          animation: {
            'pulse-slow': 'pulse 3s cubic-bezier(0.4,0,0.6,1) infinite',
          }
        }
      }
    };
  </script>
  <style>
    /* Scrollbar */
    ::-webkit-scrollbar { width: 6px; height: 6px; }
    ::-webkit-scrollbar-track { background: transparent; }
    ::-webkit-scrollbar-thumb { background: #4b5563; border-radius: 3px; }
    /* Log output */
    #install-log, #build-log, #app-log {
      font-family: 'Courier New', monospace;
      font-size: 0.78rem;
      line-height: 1.5;
      white-space: pre-wrap;
      word-break: break-all;
    }
    /* Step transitions */
    .step { display: none; }
    .step.active { display: block; }
    /* Progress bar animation */
    @keyframes progress-indeterminate {
      0%   { transform: translateX(-100%); }
      100% { transform: translateX(400%); }
    }
    .progress-indeterminate { animation: progress-indeterminate 1.5s linear infinite; }
    /* Claw logo */
    .claw-logo { font-size: 3.5rem; line-height: 1; }
  </style>
</head>
<body class="bg-gray-950 text-gray-100 min-h-screen transition-colors duration-300">

  <!-- ── Top bar ── -->
  <header class="fixed top-0 left-0 right-0 z-50 bg-gray-900/80 backdrop-blur border-b border-gray-800 px-6 py-3 flex items-center justify-between">
    <div class="flex items-center gap-3">
      <span class="text-2xl">🦀</span>
      <span class="font-bold text-lg tracking-tight text-emerald-400">SuperClaw</span>
      <span class="text-xs text-gray-500 hidden sm:inline">Setup Wizard</span>
    </div>
    <div class="flex items-center gap-3">
      <span id="env-badge" class="text-xs bg-gray-800 text-gray-400 px-2 py-1 rounded-full">${label}</span>
      <button id="theme-toggle" onclick="toggleTheme()"
        class="p-2 rounded-lg bg-gray-800 hover:bg-gray-700 transition-colors text-gray-400 hover:text-white"
        title="Toggle dark/light mode">
        <span id="theme-icon">☀️</span>
      </button>
    </div>
  </header>

  <!-- ── Step progress bar ── -->
  <div class="fixed top-[57px] left-0 right-0 z-40 bg-gray-900/60 backdrop-blur border-b border-gray-800 px-6 py-3">
    <div class="max-w-3xl mx-auto flex items-center gap-2">
      <div id="prog-1" class="step-dot flex items-center gap-2 text-sm font-medium text-emerald-400">
        <span class="w-6 h-6 rounded-full bg-emerald-500 text-white flex items-center justify-center text-xs font-bold">1</span>
        <span class="hidden sm:inline">Welcome</span>
      </div>
      <div class="flex-1 h-px bg-gray-700 mx-1"></div>
      <div id="prog-2" class="step-dot flex items-center gap-2 text-sm font-medium text-gray-500">
        <span class="w-6 h-6 rounded-full bg-gray-700 text-gray-400 flex items-center justify-center text-xs font-bold">2</span>
        <span class="hidden sm:inline">Install</span>
      </div>
      <div class="flex-1 h-px bg-gray-700 mx-1"></div>
      <div id="prog-3" class="step-dot flex items-center gap-2 text-sm font-medium text-gray-500">
        <span class="w-6 h-6 rounded-full bg-gray-700 text-gray-400 flex items-center justify-center text-xs font-bold">3</span>
        <span class="hidden sm:inline">Configure</span>
      </div>
      <div class="flex-1 h-px bg-gray-700 mx-1"></div>
      <div id="prog-4" class="step-dot flex items-center gap-2 text-sm font-medium text-gray-500">
        <span class="w-6 h-6 rounded-full bg-gray-700 text-gray-400 flex items-center justify-center text-xs font-bold">4</span>
        <span class="hidden sm:inline">Launch</span>
      </div>
    </div>
  </div>

  <!-- ── Main content ── -->
  <main class="pt-32 pb-16 px-4">
    <div class="max-w-3xl mx-auto">

      <!-- ════════════════════════════════════════════════════════════════ -->
      <!-- STEP 1: Welcome                                                  -->
      <!-- ════════════════════════════════════════════════════════════════ -->
      <div id="step-1" class="step active">
        <div class="text-center mb-10">
          <div class="claw-logo mb-4">🦀</div>
          <h1 class="text-4xl font-extrabold text-white mb-3 tracking-tight">
            Welcome to <span class="text-emerald-400">SuperClaw</span>
          </h1>
          <p class="text-gray-400 text-lg max-w-xl mx-auto">
            A lightweight, self-hosted autonomous AI agent that connects to Telegram &amp; WhatsApp
            and can execute real actions on your server.
          </p>
        </div>

        <!-- Feature pills -->
        <div class="flex flex-wrap justify-center gap-2 mb-10">
          <span class="bg-gray-800 text-gray-300 text-xs px-3 py-1 rounded-full">🤖 AI-powered</span>
          <span class="bg-gray-800 text-gray-300 text-xs px-3 py-1 rounded-full">📱 Telegram &amp; WhatsApp</span>
          <span class="bg-gray-800 text-gray-300 text-xs px-3 py-1 rounded-full">🐚 Shell execution</span>
          <span class="bg-gray-800 text-gray-300 text-xs px-3 py-1 rounded-full">📁 File management</span>
          <span class="bg-gray-800 text-gray-300 text-xs px-3 py-1 rounded-full">🌐 Web search</span>
          <span class="bg-gray-800 text-gray-300 text-xs px-3 py-1 rounded-full">🔧 Self-modifying</span>
        </div>

        <!-- Choice cards -->
        <div class="grid sm:grid-cols-2 gap-4 mb-8">
          <!-- Web UI card -->
          <button onclick="goToStep(2)"
            class="group relative bg-emerald-950/60 hover:bg-emerald-900/60 border-2 border-emerald-600 hover:border-emerald-400 rounded-2xl p-6 text-left transition-all duration-200 hover:scale-[1.02] hover:shadow-lg hover:shadow-emerald-900/40">
            <div class="flex items-start justify-between mb-3">
              <span class="text-3xl">🌐</span>
              <span class="bg-emerald-500 text-white text-xs font-bold px-2 py-0.5 rounded-full">EASY</span>
            </div>
            <h2 class="text-xl font-bold text-white mb-1">Web UI Setup</h2>
            <p class="text-emerald-300/80 text-sm mb-3">Visual browser-based wizard. No terminal knowledge needed.</p>
            <p class="text-emerald-400 text-xs font-semibold group-hover:underline">Continue with Web UI →</p>
          </button>

          <!-- Terminal card -->
          <button onclick="switchToTerminal()"
            class="group relative bg-gray-900/60 hover:bg-gray-800/60 border-2 border-gray-700 hover:border-gray-500 rounded-2xl p-6 text-left transition-all duration-200 hover:scale-[1.02]">
            <div class="flex items-start justify-between mb-3">
              <span class="text-3xl">💻</span>
              <span class="bg-gray-600 text-gray-200 text-xs font-bold px-2 py-0.5 rounded-full">ADVANCED</span>
            </div>
            <h2 class="text-xl font-bold text-white mb-1">Terminal Setup</h2>
            <p class="text-gray-400 text-sm mb-3">Command-line wizard. Faster for experienced users.</p>
            <p class="text-gray-500 text-xs font-semibold group-hover:text-gray-300 group-hover:underline">Switch to Terminal →</p>
          </button>
        </div>

        <!-- System info -->
        <div class="bg-gray-900 border border-gray-800 rounded-xl p-4 text-sm text-gray-400">
          <div class="flex flex-wrap gap-x-6 gap-y-1">
            <span>🖥️ <strong class="text-gray-300">Environment:</strong> ${label}</span>
            <span>⬡ <strong class="text-gray-300">Node.js:</strong> ${process.version}</span>
            <span id="status-pnpm">📦 <strong class="text-gray-300">pnpm:</strong> checking…</span>
            <span id="status-built">🔨 <strong class="text-gray-300">Built:</strong> checking…</span>
            <span id="status-configured">⚙️ <strong class="text-gray-300">Configured:</strong> checking…</span>
          </div>
        </div>
      </div>

      <!-- ════════════════════════════════════════════════════════════════ -->
      <!-- STEP 2: Install Dependencies                                     -->
      <!-- ════════════════════════════════════════════════════════════════ -->
      <div id="step-2" class="step">
        <div class="mb-8">
          <button onclick="goToStep(1)" class="text-gray-500 hover:text-gray-300 text-sm mb-4 flex items-center gap-1 transition-colors">
            ← Back
          </button>
          <h2 class="text-3xl font-bold text-white mb-2">Install Dependencies</h2>
          <p class="text-gray-400">This will run <code class="bg-gray-800 px-1.5 py-0.5 rounded text-emerald-400 text-sm">pnpm install</code> to download all required packages (~200 MB).</p>
        </div>

        <!-- Already installed notice -->
        <div id="already-installed" class="hidden bg-emerald-950/50 border border-emerald-700 rounded-xl p-4 mb-6 flex items-center gap-3">
          <span class="text-2xl">✅</span>
          <div>
            <p class="text-emerald-300 font-semibold">Dependencies already installed!</p>
            <p class="text-emerald-400/70 text-sm">You can skip this step and proceed to configuration.</p>
          </div>
        </div>

        <!-- Install button -->
        <div id="install-action" class="mb-6">
          <button id="install-btn" onclick="startInstall()"
            class="w-full sm:w-auto bg-emerald-600 hover:bg-emerald-500 disabled:bg-gray-700 disabled:text-gray-500 disabled:cursor-not-allowed text-white font-bold px-8 py-3 rounded-xl transition-colors flex items-center gap-2">
            <span id="install-btn-icon">📦</span>
            <span id="install-btn-text">Start Installation</span>
          </button>
        </div>

        <!-- Progress bar -->
        <div id="install-progress" class="hidden mb-4">
          <div class="flex items-center justify-between text-xs text-gray-500 mb-1">
            <span>Installing packages…</span>
            <span id="install-status-text">Running pnpm install</span>
          </div>
          <div class="h-2 bg-gray-800 rounded-full overflow-hidden">
            <div class="h-full bg-emerald-500 rounded-full progress-indeterminate w-1/3"></div>
          </div>
        </div>

        <!-- Log output -->
        <div id="install-log-wrap" class="hidden bg-gray-900 border border-gray-800 rounded-xl overflow-hidden mb-6">
          <div class="flex items-center justify-between px-4 py-2 border-b border-gray-800 bg-gray-900/80">
            <span class="text-xs text-gray-500 font-mono">pnpm install output</span>
            <button onclick="document.getElementById('install-log').textContent=''" class="text-xs text-gray-600 hover:text-gray-400">Clear</button>
          </div>
          <div id="install-log" class="p-4 max-h-64 overflow-y-auto text-gray-300"></div>
        </div>

        <!-- Next button -->
        <div id="install-next" class="hidden">
          <button onclick="goToStep(3)"
            class="bg-emerald-600 hover:bg-emerald-500 text-white font-bold px-8 py-3 rounded-xl transition-colors">
            Next: Configure →
          </button>
        </div>
      </div>

      <!-- ════════════════════════════════════════════════════════════════ -->
      <!-- STEP 3: Configure                                                -->
      <!-- ════════════════════════════════════════════════════════════════ -->
      <div id="step-3" class="step">
        <div class="mb-8">
          <button onclick="goToStep(2)" class="text-gray-500 hover:text-gray-300 text-sm mb-4 flex items-center gap-1 transition-colors">
            ← Back
          </button>
          <h2 class="text-3xl font-bold text-white mb-2">Configure SuperClaw</h2>
          <p class="text-gray-400">Set up your AI provider and messaging platform credentials.</p>
        </div>

        <form id="config-form" onsubmit="submitConfig(event)" class="space-y-6">

          <!-- AI Provider section -->
          <div class="bg-gray-900 border border-gray-800 rounded-xl p-6 space-y-4">
            <h3 class="text-lg font-semibold text-white flex items-center gap-2">
              <span>🤖</span> AI Provider
            </h3>

            <div>
              <label class="block text-sm font-medium text-gray-300 mb-1">Provider</label>
              <select id="ai-provider" name="aiProvider" onchange="onProviderChange()"
                class="w-full bg-gray-800 border border-gray-700 text-white rounded-lg px-3 py-2.5 focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-transparent">
                <option value="openai">OpenAI (GPT-4o)</option>
                <option value="anthropic">Anthropic (Claude)</option>
                <option value="groq">Groq (Llama / Mixtral)</option>
                <option value="ollama">Ollama (Local)</option>
                <option value="custom">Custom / OpenRouter</option>
              </select>
            </div>

            <div id="api-key-wrap">
              <label class="block text-sm font-medium text-gray-300 mb-1">
                API Key <span class="text-gray-500 text-xs" id="api-key-hint">(sk-…)</span>
              </label>
              <input type="password" id="api-key" name="apiKey" placeholder="Paste your API key here"
                class="w-full bg-gray-800 border border-gray-700 text-white rounded-lg px-3 py-2.5 focus:outline-none focus:ring-2 focus:ring-emerald-500 placeholder-gray-600" />
            </div>

            <div id="ollama-url-wrap" class="hidden">
              <label class="block text-sm font-medium text-gray-300 mb-1">Ollama Base URL</label>
              <input type="text" id="ollama-url" name="ollamaUrl" value="http://localhost:11434"
                class="w-full bg-gray-800 border border-gray-700 text-white rounded-lg px-3 py-2.5 focus:outline-none focus:ring-2 focus:ring-emerald-500" />
            </div>

            <div id="custom-url-wrap" class="hidden">
              <label class="block text-sm font-medium text-gray-300 mb-1">Custom Base URL</label>
              <input type="text" id="custom-url" name="customUrl" placeholder="https://openrouter.ai/api/v1"
                class="w-full bg-gray-800 border border-gray-700 text-white rounded-lg px-3 py-2.5 focus:outline-none focus:ring-2 focus:ring-emerald-500 placeholder-gray-600" />
            </div>

            <div>
              <label class="block text-sm font-medium text-gray-300 mb-1">Model</label>
              <input type="text" id="ai-model" name="aiModel" value="gpt-4o"
                class="w-full bg-gray-800 border border-gray-700 text-white rounded-lg px-3 py-2.5 focus:outline-none focus:ring-2 focus:ring-emerald-500" />
            </div>
          </div>

          <!-- Telegram section -->
          <div class="bg-gray-900 border border-gray-800 rounded-xl p-6 space-y-4">
            <h3 class="text-lg font-semibold text-white flex items-center gap-2">
              <span>✈️</span> Telegram
            </h3>
            <p class="text-gray-500 text-sm">
              Create a bot at <a href="https://t.me/BotFather" target="_blank" class="text-emerald-400 hover:underline">@BotFather</a>
              and get your Telegram ID from <a href="https://t.me/userinfobot" target="_blank" class="text-emerald-400 hover:underline">@userinfobot</a>.
            </p>

            <div>
              <label class="block text-sm font-medium text-gray-300 mb-1">Bot Token</label>
              <input type="password" id="telegram-token" name="telegramToken" placeholder="123456789:ABC-DEF…"
                class="w-full bg-gray-800 border border-gray-700 text-white rounded-lg px-3 py-2.5 focus:outline-none focus:ring-2 focus:ring-emerald-500 placeholder-gray-600" />
            </div>

            <div>
              <label class="block text-sm font-medium text-gray-300 mb-1">Your Telegram ID <span class="text-gray-500 text-xs">(admin)</span></label>
              <input type="text" id="admin-id" name="adminId" placeholder="123456789"
                class="w-full bg-gray-800 border border-gray-700 text-white rounded-lg px-3 py-2.5 focus:outline-none focus:ring-2 focus:ring-emerald-500 placeholder-gray-600" />
            </div>
          </div>

          <!-- Agent section -->
          <div class="bg-gray-900 border border-gray-800 rounded-xl p-6 space-y-4">
            <h3 class="text-lg font-semibold text-white flex items-center gap-2">
              <span>🦀</span> Agent Identity
            </h3>

            <div>
              <label class="block text-sm font-medium text-gray-300 mb-1">Agent Name</label>
              <input type="text" id="agent-name" name="agentName" value="SuperClaw"
                class="w-full bg-gray-800 border border-gray-700 text-white rounded-lg px-3 py-2.5 focus:outline-none focus:ring-2 focus:ring-emerald-500" />
            </div>
          </div>

          <!-- WhatsApp toggle -->
          <div class="bg-gray-900 border border-gray-800 rounded-xl p-6">
            <div class="flex items-center justify-between">
              <div>
                <h3 class="text-lg font-semibold text-white flex items-center gap-2">
                  <span>💬</span> WhatsApp
                  <span class="text-xs bg-gray-700 text-gray-400 px-2 py-0.5 rounded-full">Optional</span>
                </h3>
                <p class="text-gray-500 text-sm mt-1">Enable WhatsApp integration via Baileys (lightweight).</p>
              </div>
              <label class="relative inline-flex items-center cursor-pointer">
                <input type="checkbox" id="whatsapp-toggle" name="enableWhatsapp" class="sr-only peer" />
                <div class="w-11 h-6 bg-gray-700 peer-focus:outline-none peer-focus:ring-2 peer-focus:ring-emerald-500 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-emerald-600"></div>
              </label>
            </div>

            <div id="whatsapp-fields" class="hidden mt-4 space-y-3">
              <div>
                <label class="block text-sm font-medium text-gray-300 mb-1">Admin WhatsApp Number</label>
                <input type="text" id="whatsapp-number" name="adminWhatsappNumber" placeholder="15551234567"
                  class="w-full bg-gray-800 border border-gray-700 text-white rounded-lg px-3 py-2.5 focus:outline-none focus:ring-2 focus:ring-emerald-500 placeholder-gray-600" />
                <p class="text-gray-600 text-xs mt-1">International format without + (e.g. 15551234567)</p>
              </div>
            </div>
          </div>

          <!-- Error message -->
          <div id="config-error" class="hidden bg-red-950/50 border border-red-700 rounded-xl p-4 text-red-300 text-sm"></div>

          <!-- Submit -->
          <button type="submit" id="config-submit"
            class="w-full bg-emerald-600 hover:bg-emerald-500 disabled:bg-gray-700 disabled:text-gray-500 disabled:cursor-not-allowed text-white font-bold px-8 py-3 rounded-xl transition-colors flex items-center justify-center gap-2">
            <span id="config-submit-icon">⚙️</span>
            <span id="config-submit-text">Save Configuration</span>
          </button>
        </form>
      </div>

      <!-- ════════════════════════════════════════════════════════════════ -->
      <!-- STEP 4: Build & Launch                                           -->
      <!-- ════════════════════════════════════════════════════════════════ -->
      <div id="step-4" class="step">
        <div class="mb-8">
          <button onclick="goToStep(3)" class="text-gray-500 hover:text-gray-300 text-sm mb-4 flex items-center gap-1 transition-colors">
            ← Back
          </button>
          <h2 class="text-3xl font-bold text-white mb-2">Build &amp; Launch</h2>
          <p class="text-gray-400">Compile TypeScript and start SuperClaw.</p>
        </div>

        <!-- Already built notice -->
        <div id="already-built" class="hidden bg-emerald-950/50 border border-emerald-700 rounded-xl p-4 mb-6 flex items-center gap-3">
          <span class="text-2xl">✅</span>
          <div>
            <p class="text-emerald-300 font-semibold">Already built!</p>
            <p class="text-emerald-400/70 text-sm">You can skip the build step and launch directly.</p>
          </div>
        </div>

        <!-- Build button -->
        <div id="build-action" class="mb-6 flex flex-wrap gap-3">
          <button id="build-btn" onclick="startBuild()"
            class="bg-blue-600 hover:bg-blue-500 disabled:bg-gray-700 disabled:text-gray-500 disabled:cursor-not-allowed text-white font-bold px-8 py-3 rounded-xl transition-colors flex items-center gap-2">
            <span id="build-btn-icon">🔨</span>
            <span id="build-btn-text">Build TypeScript</span>
          </button>
          <button id="launch-btn" onclick="startApp()" disabled
            class="bg-emerald-600 hover:bg-emerald-500 disabled:bg-gray-700 disabled:text-gray-500 disabled:cursor-not-allowed text-white font-bold px-8 py-3 rounded-xl transition-colors flex items-center gap-2">
            <span id="launch-btn-icon">🚀</span>
            <span id="launch-btn-text">Launch SuperClaw</span>
          </button>
        </div>

        <!-- Build progress -->
        <div id="build-progress" class="hidden mb-4">
          <div class="flex items-center justify-between text-xs text-gray-500 mb-1">
            <span>Compiling TypeScript…</span>
            <span id="build-status-text">Running pnpm build</span>
          </div>
          <div class="h-2 bg-gray-800 rounded-full overflow-hidden">
            <div class="h-full bg-blue-500 rounded-full progress-indeterminate w-1/3"></div>
          </div>
        </div>

        <!-- Build log -->
        <div id="build-log-wrap" class="hidden bg-gray-900 border border-gray-800 rounded-xl overflow-hidden mb-6">
          <div class="flex items-center justify-between px-4 py-2 border-b border-gray-800 bg-gray-900/80">
            <span class="text-xs text-gray-500 font-mono">pnpm build output</span>
            <button onclick="document.getElementById('build-log').textContent=''" class="text-xs text-gray-600 hover:text-gray-400">Clear</button>
          </div>
          <div id="build-log" class="p-4 max-h-64 overflow-y-auto text-gray-300"></div>
        </div>

        <!-- App log -->
        <div id="app-log-wrap" class="hidden bg-gray-900 border border-gray-800 rounded-xl overflow-hidden mb-6">
          <div class="flex items-center justify-between px-4 py-2 border-b border-gray-800 bg-gray-900/80">
            <span class="text-xs text-gray-500 font-mono">SuperClaw startup log</span>
            <span id="app-status-badge" class="text-xs bg-yellow-900/50 text-yellow-400 px-2 py-0.5 rounded-full">Starting…</span>
          </div>
          <div id="app-log" class="p-4 max-h-64 overflow-y-auto text-gray-300"></div>
        </div>

        <!-- Success panel -->
        <div id="success-panel" class="hidden bg-emerald-950/60 border-2 border-emerald-600 rounded-2xl p-8 text-center">
          <div class="text-5xl mb-4">🎉</div>
          <h3 class="text-2xl font-bold text-white mb-2">SuperClaw is Running!</h3>
          <p class="text-emerald-300 mb-6">Your AI agent is now active and listening for messages.</p>
          <div class="bg-gray-900/60 rounded-xl p-4 text-left text-sm space-y-2 mb-6">
            <p class="text-gray-400">📱 <strong class="text-white">Telegram:</strong> Send a message to your bot to start chatting</p>
            <p class="text-gray-400">💬 <strong class="text-white">WhatsApp:</strong> Scan the QR code in the terminal (if enabled)</p>
            <p class="text-gray-400">📋 <strong class="text-white">Logs:</strong> <code class="bg-gray-800 px-1 rounded text-emerald-400">pm2 logs superclaw</code></p>
          </div>
          <div id="daemon-tip" class="text-gray-500 text-sm"></div>
        </div>
      </div>

    </div>
  </main>

  <!-- ── Terminal mode modal ── -->
  <div id="terminal-modal" class="hidden fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
    <div class="bg-gray-900 border border-gray-700 rounded-2xl p-8 max-w-md w-full text-center">
      <div class="text-4xl mb-4">💻</div>
      <h3 class="text-xl font-bold text-white mb-2">Switch to Terminal Setup?</h3>
      <p class="text-gray-400 text-sm mb-6">
        The web server will stop and the terminal wizard will start in your console.
        Make sure you have access to the terminal where you ran <code class="bg-gray-800 px-1 rounded text-emerald-400">node quickstart.js</code>.
      </p>
      <div class="flex gap-3 justify-center">
        <button onclick="closeTerminalModal()"
          class="bg-gray-700 hover:bg-gray-600 text-white px-6 py-2.5 rounded-xl font-medium transition-colors">
          Cancel
        </button>
        <button onclick="confirmTerminalMode()"
          class="bg-gray-600 hover:bg-gray-500 text-white px-6 py-2.5 rounded-xl font-medium transition-colors">
          Yes, switch to terminal
        </button>
      </div>
    </div>
  </div>

  <!-- ── Toast notifications ── -->
  <div id="toast-container" class="fixed bottom-6 right-6 z-50 space-y-2 pointer-events-none"></div>

  <script>
    // ── State ──────────────────────────────────────────────────────────────
    const ENV = ${envJson};
    let currentStep = 1;
    let installDone = false;
    let buildDone   = false;

    // ── Theme ──────────────────────────────────────────────────────────────
    function toggleTheme() {
      const html = document.documentElement;
      const isDark = html.classList.toggle('dark');
      document.getElementById('theme-icon').textContent = isDark ? '☀️' : '🌙';
      localStorage.setItem('theme', isDark ? 'dark' : 'light');
    }

    // Restore saved theme
    (function() {
      const saved = localStorage.getItem('theme');
      if (saved === 'light') {
        document.documentElement.classList.remove('dark');
        document.getElementById('theme-icon').textContent = '🌙';
      }
    })();

    // ── Step navigation ────────────────────────────────────────────────────
    function goToStep(n) {
      document.getElementById('step-' + currentStep).classList.remove('active');
      document.getElementById('step-' + n).classList.add('active');
      currentStep = n;
      updateProgressBar(n);
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }

    function updateProgressBar(n) {
      for (let i = 1; i <= 4; i++) {
        const dot = document.getElementById('prog-' + i);
        const circle = dot.querySelector('span:first-child');
        if (i < n) {
          dot.className = 'step-dot flex items-center gap-2 text-sm font-medium text-emerald-400';
          circle.className = 'w-6 h-6 rounded-full bg-emerald-500 text-white flex items-center justify-center text-xs font-bold';
          circle.textContent = '✓';
        } else if (i === n) {
          dot.className = 'step-dot flex items-center gap-2 text-sm font-medium text-emerald-400';
          circle.className = 'w-6 h-6 rounded-full bg-emerald-500 text-white flex items-center justify-center text-xs font-bold';
          circle.textContent = i;
        } else {
          dot.className = 'step-dot flex items-center gap-2 text-sm font-medium text-gray-500';
          circle.className = 'w-6 h-6 rounded-full bg-gray-700 text-gray-400 flex items-center justify-center text-xs font-bold';
          circle.textContent = i;
        }
      }
    }

    // ── Toast ──────────────────────────────────────────────────────────────
    function toast(msg, type = 'info') {
      const colors = {
        info:    'bg-gray-800 border-gray-700 text-gray-200',
        success: 'bg-emerald-900/80 border-emerald-700 text-emerald-200',
        error:   'bg-red-900/80 border-red-700 text-red-200',
      };
      const el = document.createElement('div');
      el.className = 'pointer-events-auto border rounded-xl px-4 py-3 text-sm shadow-lg max-w-xs ' + (colors[type] || colors.info);
      el.textContent = msg;
      document.getElementById('toast-container').appendChild(el);
      setTimeout(() => el.remove(), 4000);
    }

    // ── Status polling ─────────────────────────────────────────────────────
    async function refreshStatus() {
      try {
        const r = await fetch('/api/status');
        const s = await r.json();
        document.getElementById('status-pnpm').innerHTML =
          '📦 <strong class="text-gray-300">pnpm:</strong> ' + (s.pnpmInstalled ? '✅' : '❌');
        document.getElementById('status-built').innerHTML =
          '🔨 <strong class="text-gray-300">Built:</strong> ' + (s.built ? '✅' : '❌');
        document.getElementById('status-configured').innerHTML =
          '⚙️ <strong class="text-gray-300">Configured:</strong> ' + (s.configured ? '✅' : '❌');

        // Show "already installed" notice on step 2
        if (s.built || document.getElementById('node_modules_exists')) {
          // We check node_modules via a separate heuristic — just check if pnpm installed
        }
        if (s.built) {
          document.getElementById('already-built').classList.remove('hidden');
          document.getElementById('launch-btn').disabled = false;
          buildDone = true;
        }
        return s;
      } catch { return {}; }
    }

    refreshStatus();

    // ── Provider change ────────────────────────────────────────────────────
    const providerModels = {
      openai:    'gpt-4o',
      anthropic: 'claude-3-5-sonnet-20241022',
      groq:      'llama3-70b-8192',
      ollama:    'llama3',
      custom:    'mistral-7b-instruct',
    };
    const providerKeyHints = {
      openai:    '(sk-…)',
      anthropic: '(sk-ant-…)',
      groq:      '(gsk_…)',
      ollama:    '(not required)',
      custom:    '(provider-specific)',
    };

    function onProviderChange() {
      const p = document.getElementById('ai-provider').value;
      document.getElementById('ai-model').value = providerModels[p] || '';
      document.getElementById('api-key-hint').textContent = providerKeyHints[p] || '';
      document.getElementById('ollama-url-wrap').classList.toggle('hidden', p !== 'ollama');
      document.getElementById('custom-url-wrap').classList.toggle('hidden', p !== 'custom');
      document.getElementById('api-key-wrap').classList.toggle('hidden', p === 'ollama');
    }

    // WhatsApp toggle
    document.getElementById('whatsapp-toggle').addEventListener('change', function() {
      document.getElementById('whatsapp-fields').classList.toggle('hidden', !this.checked);
    });

    // ── Install ────────────────────────────────────────────────────────────
    async function startInstall() {
      const btn = document.getElementById('install-btn');
      btn.disabled = true;
      document.getElementById('install-btn-icon').textContent = '⏳';
      document.getElementById('install-btn-text').textContent = 'Installing…';
      document.getElementById('install-progress').classList.remove('hidden');
      document.getElementById('install-log-wrap').classList.remove('hidden');

      // Trigger install
      await fetch('/api/install', { method: 'POST' });

      // Stream output
      const log = document.getElementById('install-log');
      const es = new EventSource('/api/install/stream');

      es.onmessage = (e) => {
        const d = JSON.parse(e.data);
        if (d.line) {
          log.textContent += d.line;
          log.scrollTop = log.scrollHeight;
        }
        if (d.done) {
          es.close();
          document.getElementById('install-progress').classList.add('hidden');
          if (d.success) {
            document.getElementById('install-btn-icon').textContent = '✅';
            document.getElementById('install-btn-text').textContent = 'Installed!';
            document.getElementById('install-next').classList.remove('hidden');
            installDone = true;
            toast('Dependencies installed successfully!', 'success');
          } else {
            document.getElementById('install-btn-icon').textContent = '❌';
            document.getElementById('install-btn-text').textContent = 'Failed — check log';
            btn.disabled = false;
            toast('Installation failed. Check the log output.', 'error');
          }
        }
      };

      es.onerror = () => {
        es.close();
        document.getElementById('install-progress').classList.add('hidden');
        btn.disabled = false;
        document.getElementById('install-btn-icon').textContent = '📦';
        document.getElementById('install-btn-text').textContent = 'Retry Installation';
        toast('Connection lost. Please retry.', 'error');
      };
    }

    // ── Configure ──────────────────────────────────────────────────────────
    async function submitConfig(e) {
      e.preventDefault();
      const btn = document.getElementById('config-submit');
      const errEl = document.getElementById('config-error');
      errEl.classList.add('hidden');
      btn.disabled = true;
      document.getElementById('config-submit-icon').textContent = '⏳';
      document.getElementById('config-submit-text').textContent = 'Saving…';

      const provider = document.getElementById('ai-provider').value;
      const payload = {
        aiProvider:          provider,
        apiKey:              document.getElementById('api-key').value,
        aiModel:             document.getElementById('ai-model').value,
        telegramToken:       document.getElementById('telegram-token').value,
        adminId:             document.getElementById('admin-id').value,
        agentName:           document.getElementById('agent-name').value,
        enableWhatsapp:      document.getElementById('whatsapp-toggle').checked,
        adminWhatsappNumber: document.getElementById('whatsapp-number').value,
        ollamaUrl:           document.getElementById('ollama-url').value,
        customUrl:           document.getElementById('custom-url').value,
      };

      try {
        const r = await fetch('/api/configure', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
        const data = await r.json();
        if (data.success) {
          toast('Configuration saved!', 'success');
          goToStep(4);
          refreshStatus();
        } else {
          errEl.textContent = data.error || 'Failed to save configuration.';
          errEl.classList.remove('hidden');
          btn.disabled = false;
          document.getElementById('config-submit-icon').textContent = '⚙️';
          document.getElementById('config-submit-text').textContent = 'Save Configuration';
        }
      } catch (err) {
        errEl.textContent = 'Network error: ' + err.message;
        errEl.classList.remove('hidden');
        btn.disabled = false;
        document.getElementById('config-submit-icon').textContent = '⚙️';
        document.getElementById('config-submit-text').textContent = 'Save Configuration';
      }
    }

    // ── Build ──────────────────────────────────────────────────────────────
    async function startBuild() {
      const btn = document.getElementById('build-btn');
      btn.disabled = true;
      document.getElementById('build-btn-icon').textContent = '⏳';
      document.getElementById('build-btn-text').textContent = 'Building…';
      document.getElementById('build-progress').classList.remove('hidden');
      document.getElementById('build-log-wrap').classList.remove('hidden');

      await fetch('/api/build', { method: 'POST' });

      const log = document.getElementById('build-log');
      const es = new EventSource('/api/build/stream');

      es.onmessage = (e) => {
        const d = JSON.parse(e.data);
        if (d.line) {
          log.textContent += d.line;
          log.scrollTop = log.scrollHeight;
        }
        if (d.done) {
          es.close();
          document.getElementById('build-progress').classList.add('hidden');
          if (d.success) {
            document.getElementById('build-btn-icon').textContent = '✅';
            document.getElementById('build-btn-text').textContent = 'Build Complete!';
            document.getElementById('launch-btn').disabled = false;
            buildDone = true;
            toast('Build successful!', 'success');
          } else {
            document.getElementById('build-btn-icon').textContent = '❌';
            document.getElementById('build-btn-text').textContent = 'Build Failed';
            btn.disabled = false;
            toast('Build failed. Check the log output.', 'error');
          }
        }
      };

      es.onerror = () => {
        es.close();
        document.getElementById('build-progress').classList.add('hidden');
        btn.disabled = false;
        document.getElementById('build-btn-icon').textContent = '🔨';
        document.getElementById('build-btn-text').textContent = 'Retry Build';
        toast('Connection lost. Please retry.', 'error');
      };
    }

    // ── Launch app ─────────────────────────────────────────────────────────
    async function startApp() {
      const btn = document.getElementById('launch-btn');
      btn.disabled = true;
      document.getElementById('launch-btn-icon').textContent = '⏳';
      document.getElementById('launch-btn-text').textContent = 'Launching…';
      document.getElementById('app-log-wrap').classList.remove('hidden');

      await fetch('/api/start', { method: 'POST' });

      const log = document.getElementById('app-log');
      const es = new EventSource('/api/logs/stream');

      es.onmessage = (e) => {
        const d = JSON.parse(e.data);
        if (d.line) {
          log.textContent += d.line;
          log.scrollTop = log.scrollHeight;
        }
        if (d.started) {
          document.getElementById('app-status-badge').textContent = '🟢 Running';
          document.getElementById('app-status-badge').className =
            'text-xs bg-emerald-900/50 text-emerald-400 px-2 py-0.5 rounded-full';
          document.getElementById('success-panel').classList.remove('hidden');
          document.getElementById('launch-btn-icon').textContent = '✅';
          document.getElementById('launch-btn-text').textContent = 'Running!';
          toast('SuperClaw is running!', 'success');

          // Daemon tip
          const tip = document.getElementById('daemon-tip');
          if (ENV.envType === 'termux') {
            tip.innerHTML = '💡 <strong>Tip:</strong> Install Termux:Boot from F-Droid to keep SuperClaw running after reboot.';
          } else if (['vps-linux','vps-aapanel','vps-cpanel','vps-plesk'].includes(ENV.envType)) {
            tip.innerHTML = '💡 <strong>Tip:</strong> Run <code class="bg-gray-800 px-1 rounded text-emerald-400">pm2 start ecosystem.config.js && pm2 save && pm2 startup</code> to keep it running after reboot.';
          }
        }
        if (d.error) {
          document.getElementById('app-status-badge').textContent = '🔴 Error';
          document.getElementById('app-status-badge').className =
            'text-xs bg-red-900/50 text-red-400 px-2 py-0.5 rounded-full';
          btn.disabled = false;
          document.getElementById('launch-btn-icon').textContent = '🚀';
          document.getElementById('launch-btn-text').textContent = 'Retry Launch';
          toast('Launch failed. Check the log.', 'error');
        }
      };

      es.onerror = () => {
        // SSE closed — app may have started or crashed
        es.close();
      };
    }

    // ── Terminal mode ──────────────────────────────────────────────────────
    function switchToTerminal() {
      document.getElementById('terminal-modal').classList.remove('hidden');
    }

    function closeTerminalModal() {
      document.getElementById('terminal-modal').classList.add('hidden');
    }

    async function confirmTerminalMode() {
      closeTerminalModal();
      try {
        await fetch('/api/terminal-mode', { method: 'POST' });
        toast('Switching to terminal mode… check your console.', 'info');
      } catch { /* server may close */ }
    }

    // ── Step 2: check if already installed ────────────────────────────────
    (async function checkInstalled() {
      const s = await refreshStatus();
      // We show "already installed" if node_modules exists (built implies installed)
      // We'll check via a dedicated status field
      try {
        const r = await fetch('/api/status');
        const data = await r.json();
        if (data.nodeModulesExist) {
          document.getElementById('already-installed').classList.remove('hidden');
          document.getElementById('install-next').classList.remove('hidden');
          installDone = true;
        }
      } catch {}
    })();
  </script>
</body>
</html>`;
}

// ── HTTP request router ───────────────────────────────────────────────────
async function handleRequest(req, res, env, ip, port) {
  const url = req.url.split('?')[0];
  const method = req.method;

  // ── CORS / common headers helper ─────────────────────────────────────
  function json(data, status = 200) {
    res.writeHead(status, {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-cache',
    });
    res.end(JSON.stringify(data));
  }

  function sse() {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    res.write(':\n\n'); // comment to flush
  }

  // ── GET / ─────────────────────────────────────────────────────────────
  if (method === 'GET' && url === '/') {
    const html = buildHTML(env, ip, port);
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(html);
    return;
  }

  // ── GET /api/status ───────────────────────────────────────────────────
  if (method === 'GET' && url === '/api/status') {
    const status = getStatus();
    const nodeModulesExist = fs.existsSync(path.join(projectDir, 'node_modules', '.modules.yaml')) ||
                             fs.existsSync(path.join(projectDir, 'node_modules', 'typescript'));
    json({ ...status, nodeModulesExist, envType: env.envType, envLabel: envLabel(env) });
    return;
  }

  // ── POST /api/install ─────────────────────────────────────────────────
  if (method === 'POST' && url === '/api/install') {
    json({ ok: true });
    // Kick off install asynchronously
    const pm = env.hasPnpm ? 'pnpm' : (env.hasNpm ? 'npm' : 'npm');
    const args = env.hasPnpm
      ? (env.isTermux ? ['install', '--no-optional'] : ['install'])
      : (env.isTermux ? ['install', '--omit=optional'] : ['install']);
    spawnStreamed('install', pm, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    return;
  }

  // ── GET /api/install/stream ───────────────────────────────────────────
  if (method === 'GET' && url === '/api/install/stream') {
    sse();
    sseClients.install.add(res);
    req.on('close', () => sseClients.install.delete(res));
    return;
  }

  // ── POST /api/build ───────────────────────────────────────────────────
  if (method === 'POST' && url === '/api/build') {
    json({ ok: true });
    const pm = env.hasPnpm ? 'pnpm' : 'npm';
    const args = env.hasPnpm ? ['build'] : ['run', 'build'];
    spawnStreamed('build', pm, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    return;
  }

  // ── GET /api/build/stream ─────────────────────────────────────────────
  if (method === 'GET' && url === '/api/build/stream') {
    sse();
    sseClients.build.add(res);
    req.on('close', () => sseClients.build.delete(res));
    return;
  }

  // ── POST /api/configure ───────────────────────────────────────────────
  if (method === 'POST' && url === '/api/configure') {
    let body;
    try { body = await readBody(req); } catch { return json({ success: false, error: 'Invalid JSON' }, 400); }

    const {
      aiProvider = 'openai',
      apiKey = '',
      aiModel = 'gpt-4o',
      telegramToken = '',
      adminId = '',
      agentName = 'SuperClaw',
      enableWhatsapp = false,
      adminWhatsappNumber = '',
      ollamaUrl = 'http://localhost:11434',
      customUrl = '',
    } = body;

    // Build .env content
    const lines = [
      `# SuperClaw Configuration — generated by quickstart.js`,
      `# Generated: ${new Date().toISOString()}`,
      ``,
      `# ── AI Provider ──────────────────────────────────────────────────`,
      `AI_PROVIDER=${aiProvider}`,
      `AI_MODEL=${aiModel}`,
      ``,
    ];

    if (aiProvider === 'openai') {
      lines.push(`OPENAI_API_KEY=${apiKey}`);
    } else if (aiProvider === 'anthropic') {
      lines.push(`ANTHROPIC_API_KEY=${apiKey}`);
    } else if (aiProvider === 'groq') {
      lines.push(`GROQ_API_KEY=${apiKey}`);
    } else if (aiProvider === 'ollama') {
      lines.push(`OLLAMA_BASE_URL=${ollamaUrl}`);
    } else if (aiProvider === 'custom') {
      lines.push(`CUSTOM_AI_BASE_URL=${customUrl}`);
      lines.push(`CUSTOM_AI_API_KEY=${apiKey}`);
      lines.push(`CUSTOM_AI_MODEL=${aiModel}`);
    }

    lines.push(
      ``,
      `# ── Telegram ─────────────────────────────────────────────────────`,
      `TELEGRAM_BOT_TOKEN=${telegramToken}`,
      `ADMIN_TELEGRAM_ID=${adminId}`,
      ``,
      `# ── Agent Identity ───────────────────────────────────────────────`,
      `AGENT_NAME=${agentName}`,
      `VPS_HOSTNAME=${os.hostname()}`,
      ``,
      `# ── Platforms ────────────────────────────────────────────────────`,
    );

    if (enableWhatsapp) {
      lines.push(`ADMIN_WHATSAPP_NUMBER=${adminWhatsappNumber}@c.us`);
      lines.push(`WHATSAPP_SESSION_NAME=superclaw`);
    }

    lines.push(
      ``,
      `# ── Paths & Limits ───────────────────────────────────────────────`,
      `LOG_LEVEL=info`,
      `DB_PATH=./data/superclaw.db`,
      `MAX_MESSAGES_PER_MINUTE=30`,
      `MAX_AI_CALLS_PER_MINUTE=10`,
      `MAX_CONCURRENT_TOOLS=5`,
      `MAX_CONCURRENT_AGENTS=5`,
      `SUBAGENT_TIMEOUT_MS=600000`,
    );

    try {
      fs.writeFileSync(path.join(projectDir, '.env'), lines.join('\n') + '\n', 'utf8');
      json({ success: true });
    } catch (err) {
      json({ success: false, error: err.message });
    }
    return;
  }

  // ── POST /api/start ───────────────────────────────────────────────────
  if (method === 'POST' && url === '/api/start') {
    json({ ok: true });

    if (appProcess) {
      try { appProcess.kill(); } catch { /* ignore */ }
    }

    const distIndex = path.join(projectDir, 'dist', 'index.js');
    appProcess = spawn(process.execPath, [distIndex], {
      cwd: projectDir,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env },
    });

    let started = false;

    function onLine(data) {
      const line = data.toString();
      sseWrite('app', { line });
      // Detect successful startup
      if (!started && (
        line.includes('listening') ||
        line.includes('started') ||
        line.includes('ready') ||
        line.includes('connected') ||
        line.includes('SuperClaw')
      )) {
        started = true;
        sseWrite('app', { started: true });
      }
    }

    appProcess.stdout.on('data', onLine);
    appProcess.stderr.on('data', onLine);

    appProcess.on('error', (err) => {
      sseWrite('app', { line: `ERROR: ${err.message}\n`, error: err.message });
    });

    appProcess.on('close', (code) => {
      if (!started) {
        sseWrite('app', { line: `Process exited with code ${code}\n`, error: `Exited with code ${code}` });
      }
    });

    return;
  }

  // ── GET /api/logs/stream ──────────────────────────────────────────────
  if (method === 'GET' && url === '/api/logs/stream') {
    sse();
    sseClients.app.add(res);
    req.on('close', () => sseClients.app.delete(res));
    return;
  }

  // ── POST /api/terminal-mode ───────────────────────────────────────────
  if (method === 'POST' && url === '/api/terminal-mode') {
    json({ ok: true });
    terminalModeRequested = true;
    // Give the response time to send before we kill the server
    setTimeout(() => process.emit('SIGINT'), 500);
    return;
  }

  // ── 404 ───────────────────────────────────────────────────────────────
  res.writeHead(404, { 'Content-Type': 'text/plain' });
  res.end('Not found');
}

// ── Terminal wizard fallback ──────────────────────────────────────────────
async function runTerminalWizard() {
  const distWizard = path.join(projectDir, 'dist', 'setup', 'wizard.js');

  if (fs.existsSync(distWizard)) {
    console.log('\n' + green('✅ Launching terminal wizard...'));
    const child = spawn(process.execPath, [distWizard], {
      stdio: 'inherit',
      cwd: projectDir,
    });
    child.on('error', (err) => {
      console.error(red('❌ Failed to start wizard: ' + err.message));
      process.exit(1);
    });
    child.on('exit', (code) => process.exit(code || 0));
    process.on('SIGINT',  () => child.kill('SIGINT'));
    process.on('SIGTERM', () => child.kill('SIGTERM'));
    return;
  }

  // Inline minimal terminal wizard using readline
  console.log('\n' + bold(cyan('💻 Terminal Setup Wizard')));
  console.log(cyan('═'.repeat(40)));
  console.log(yellow('⚠️  Note: The full wizard requires a build first.'));
  console.log('   Run the following commands manually:\n');
  console.log(dim('   1. pnpm install'));
  console.log(dim('   2. pnpm build'));
  console.log(dim('   3. node dist/setup/wizard.js'));
  console.log('');

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

  function ask(question) {
    return new Promise(resolve => rl.question(question, resolve));
  }

  console.log(bold('\nQuick configuration (minimal setup):'));
  console.log(dim('Press Enter to skip optional fields.\n'));

  const provider    = (await ask(bold('AI Provider') + dim(' [openai/anthropic/groq/ollama/custom]: '))).trim() || 'openai';
  const apiKey      = (await ask(bold('API Key: '))).trim();
  const model       = (await ask(bold('AI Model') + dim(` [default: ${providerModels[provider] || 'gpt-4o'}]: `))).trim() || (providerModels[provider] || 'gpt-4o');
  const tgToken     = (await ask(bold('Telegram Bot Token: '))).trim();
  const adminId     = (await ask(bold('Admin Telegram ID: '))).trim();
  const agentName   = (await ask(bold('Agent Name') + dim(' [default: SuperClaw]: '))).trim() || 'SuperClaw';

  rl.close();

  const providerModels = {
    openai: 'gpt-4o', anthropic: 'claude-3-5-sonnet-20241022',
    groq: 'llama3-70b-8192', ollama: 'llama3', custom: 'mistral-7b-instruct',
  };

  const lines = [
    `# SuperClaw Configuration — generated by quickstart.js terminal wizard`,
    `# Generated: ${new Date().toISOString()}`,
    ``,
    `AI_PROVIDER=${provider}`,
    `AI_MODEL=${model}`,
  ];

  if (provider === 'openai')    lines.push(`OPENAI_API_KEY=${apiKey}`);
  if (provider === 'anthropic') lines.push(`ANTHROPIC_API_KEY=${apiKey}`);
  if (provider === 'groq')      lines.push(`GROQ_API_KEY=${apiKey}`);
  if (provider === 'ollama')    lines.push(`OLLAMA_BASE_URL=http://localhost:11434`);
  if (provider === 'custom')    lines.push(`CUSTOM_AI_BASE_URL=`, `CUSTOM_AI_API_KEY=${apiKey}`, `CUSTOM_AI_MODEL=${model}`);

  lines.push(
    ``,
    `TELEGRAM_BOT_TOKEN=${tgToken}`,
    `ADMIN_TELEGRAM_ID=${adminId}`,
    `AGENT_NAME=${agentName}`,
    `VPS_HOSTNAME=${os.hostname()}`,
    `LOG_LEVEL=info`,
    `DB_PATH=./data/superclaw.db`,
    `MAX_MESSAGES_PER_MINUTE=30`,
    `MAX_AI_CALLS_PER_MINUTE=10`,
    `MAX_CONCURRENT_TOOLS=5`,
    `MAX_CONCURRENT_AGENTS=5`,
    `SUBAGENT_TIMEOUT_MS=600000`,
  );

  fs.writeFileSync(path.join(projectDir, '.env'), lines.join('\n') + '\n', 'utf8');
  console.log('\n' + green('✅ .env file written!'));
  console.log('\n' + bold('Next steps:'));
  console.log(dim('  pnpm install'));
  console.log(dim('  pnpm build'));
  console.log(dim('  pnpm start'));
  console.log('');
  process.exit(0);
}

// ── Print terminal instructions ───────────────────────────────────────────
function printTerminalInstructions(env, ip, port) {
  const sep = '═'.repeat(60);
  console.log('\n' + bold(cyan(sep)));
  console.log(bold(green('  🌐 SuperClaw Web Setup is ready!')));
  console.log(bold(cyan(sep)));

  console.log('');
  console.log('  ' + bold('Open this URL in your browser:'));
  console.log('');

  if (env.isTermux) {
    console.log('  ' + bold(cyan(`  http://localhost:${port}`)) + dim('  ← from this device'));
    console.log('  ' + bold(cyan(`  http://${ip}:${port}`))    + dim('  ← from other devices'));
  } else if (['vps-linux','vps-aapanel','vps-cpanel','vps-plesk'].includes(env.envType)) {
    console.log('  ' + bold(cyan(`  http://${ip}:${port}`)));
    console.log('');
    console.log('  ' + yellow(`  ⚠️  If port ${port} is blocked, open it:`));
    console.log('  ' + dim(`     ufw allow ${port}/tcp`));
  } else if (env.isDocker) {
    console.log('  ' + bold(cyan(`  http://localhost:${port}`)));
    console.log('  ' + dim(`  (ensure port ${port} is mapped in docker run)`));
  } else {
    console.log('  ' + bold(cyan(`  http://localhost:${port}`)));
    if (ip !== 'localhost') {
      console.log('  ' + bold(cyan(`  http://${ip}:${port}`)) + dim('  ← from other devices'));
    }
  }

  console.log('');
  console.log('  ' + dim('Press Ctrl+C to stop the server and switch to terminal setup.'));
  console.log(bold(cyan(sep)) + '\n');
}

// ── Main ──────────────────────────────────────────────────────────────────
async function main() {
  // ── 1. Welcome banner ────────────────────────────────────────────────────
  console.log('');
  console.log(bold(cyan('  🦀 SuperClaw Quickstart')));
  console.log(cyan('  ' + '─'.repeat(40)));
  console.log('');

  // ── 2. Node.js version check ─────────────────────────────────────────────
  const nodeVersion = parseInt(process.version.slice(1).split('.')[0], 10);
  if (nodeVersion < 18) {
    console.error(red('  ❌ Node.js 18+ required. Current: ' + process.version));
    process.exit(1);
  }
  console.log(green('  ✅ Node.js ' + process.version));

  // ── 3. Find a free port ───────────────────────────────────────────────────
  const preferredPort = parseInt(process.env.WEB_PORT || '3000', 10);
  const port = await findFreePort(preferredPort);
  if (port !== preferredPort) {
    console.log(yellow(`  ⚠️  Port ${preferredPort} in use, using port ${port}`));
  }

  // ── 4. Detect environment (non-blocking, runs in background) ─────────────
  let env = {
    envType: 'unknown', platform: process.platform,
    isTermux: false, isDocker: false, isLinux: process.platform === 'linux',
    isMac: process.platform === 'darwin', isWindows: process.platform === 'win32',
    isRoot: false, hasAaPanel: false, hasCpanel: false, hasPleskPanel: false,
    hasNginx: false, hasApache: false, hasPm2: false, hasSystemd: false,
    hasPnpm: false, hasNpm: true, hasYarn: false, packageManager: 'npm',
  };

  // Detect synchronously (fast enough, no network calls)
  try { env = detectEnvironment(); } catch { /* use defaults */ }

  // ── 5. Start HTTP server immediately ─────────────────────────────────────
  let ip = 'localhost';

  const server = http.createServer((req, res) => {
    handleRequest(req, res, env, ip, port).catch((err) => {
      console.error(red('  ❌ Request error: ' + err.message));
      if (!res.headersSent) {
        res.writeHead(500, { 'Content-Type': 'text/plain' });
        res.end('Internal server error');
      }
    });
  });

  await new Promise((resolve, reject) => {
    server.listen(port, '0.0.0.0', resolve);
    server.on('error', reject);
  });

  // ── 6. Print instructions immediately ────────────────────────────────────
  printTerminalInstructions(env, ip, port);

  // ── 7. Detect public IP in background (update instructions if different) ──
  getPublicIP().then((detectedIp) => {
    if (detectedIp !== ip && detectedIp !== 'localhost') {
      ip = detectedIp;
      // Reprint with real IP
      console.log(dim('  📡 Public IP detected: ') + cyan(ip));
      console.log(dim('  🌐 Remote URL: ') + bold(cyan(`http://${ip}:${port}`)));
      console.log('');
    }
  }).catch(() => { /* non-fatal */ });

  // ── 8. Handle Ctrl+C → terminal mode ─────────────────────────────────────
  process.on('SIGINT', async () => {
    console.log('');
    if (terminalModeRequested) {
      console.log(yellow('  🔄 Switching to terminal setup...'));
    } else {
      console.log(yellow('  ⌨️  Ctrl+C detected — switching to terminal setup...'));
    }

    // Stop app process if running
    if (appProcess) {
      try { appProcess.kill(); } catch { /* ignore */ }
    }

    server.close(() => {
      runTerminalWizard().catch((err) => {
        console.error(red('  ❌ Terminal wizard failed: ' + err.message));
        process.exit(1);
      });
    });
  });

  process.on('SIGTERM', () => {
    server.close();
    process.exit(0);
  });
}

main().catch((err) => {
  console.error(red('❌ Quickstart failed: ' + err.message));
  process.exit(1);
});
