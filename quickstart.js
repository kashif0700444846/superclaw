#!/usr/bin/env node
'use strict';

const { execSync, spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');

const projectDir = __dirname;

console.log('🦀 SuperClaw Quickstart');
console.log('=======================\n');

// ── Step 1: Check Node.js version ─────────────────────────────────────────
const nodeVersion = parseInt(process.version.slice(1).split('.')[0], 10);
if (nodeVersion < 18) {
  console.error('❌ Node.js 18+ required. Current:', process.version);
  process.exit(1);
}
console.log('✅ Node.js', process.version);

// ── Step 2: Install dependencies if needed ─────────────────────────────────
if (!fs.existsSync(path.join(projectDir, 'node_modules', 'express'))) {
  console.log('\n📦 Installing dependencies...');
  try {
    execSync('pnpm install --no-optional', { stdio: 'inherit', cwd: projectDir });
  } catch {
    try {
      execSync('npm install --omit=optional', { stdio: 'inherit', cwd: projectDir });
    } catch (err) {
      console.error('❌ Failed to install dependencies:', err.message);
      process.exit(1);
    }
  }
  console.log('✅ Dependencies installed');
} else {
  console.log('✅ Dependencies already installed');
}

// ── Step 3: Build TypeScript if needed ────────────────────────────────────
const webServerDist = path.join(projectDir, 'dist', 'web', 'WebServer.js');
if (!fs.existsSync(webServerDist)) {
  console.log('\n🔨 Building TypeScript...');
  try {
    execSync('npx tsc', { stdio: 'inherit', cwd: projectDir });
    console.log('✅ Build complete');
  } catch {
    try {
      execSync('npm run build', { stdio: 'inherit', cwd: projectDir });
      console.log('✅ Build complete');
    } catch (err) {
      console.error('❌ Build failed:', err.message);
      console.error('   Try running: npm run build');
      process.exit(1);
    }
  }
} else {
  console.log('✅ Build already exists');
}

// ── Step 4: Get local IP for display ──────────────────────────────────────
function getLocalIP() {
  const interfaces = os.networkInterfaces();
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name]) {
      if (iface.family === 'IPv4' && !iface.internal) {
        return iface.address;
      }
    }
  }
  return 'localhost';
}

const port = process.env.WEB_PORT || 3000;
const ip = getLocalIP();

console.log('\n🌐 Starting SuperClaw Web UI...\n');
console.log('╔══════════════════════════════════════════════╗');
console.log('║                                              ║');
console.log(`║   👉  http://localhost:${port}               ║`);
if (ip !== 'localhost') {
  console.log(`║   👉  http://${ip}:${port}                  ║`);
}
console.log('║                                              ║');
console.log('║   Open the URL above in your browser        ║');
console.log('║   Press Ctrl+C to stop                      ║');
console.log('║                                              ║');
console.log('╚══════════════════════════════════════════════╝\n');

// ── Step 5: Start the web server ───────────────────────────────────────────
const child = spawn(
  process.execPath,
  [path.join(projectDir, 'dist', 'web', 'WebServer.js')],
  {
    stdio: 'inherit',
    cwd: projectDir,
    env: {
      ...process.env,
      WEB_ONLY: 'true',
      WEB_PORT: String(port),
    },
  }
);

child.on('error', (err) => {
  console.error('❌ Failed to start web server:', err.message);
  process.exit(1);
});

child.on('exit', (code) => {
  process.exit(code || 0);
});

// Forward signals to child
process.on('SIGINT', () => { child.kill('SIGINT'); });
process.on('SIGTERM', () => { child.kill('SIGTERM'); });
