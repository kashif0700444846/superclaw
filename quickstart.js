#!/usr/bin/env node
'use strict';

const { execSync, spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

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

// ── Step 4: Detect public IP (VPS-aware) ──────────────────────────────────
async function getPublicIP() {
  const https = require('https');

  function fetchIP(url) {
    return new Promise((resolve, reject) => {
      const req = https.get(url, { timeout: 3000 }, (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => resolve(data.trim()));
      });
      req.on('error', reject);
      req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
    });
  }

  // Try public IP services first (needed on VPS where os.networkInterfaces() returns private IP)
  for (const url of ['https://api.ipify.org', 'https://ifconfig.me/ip', 'https://icanhazip.com']) {
    try {
      const ip = await fetchIP(url);
      if (/^\d+\.\d+\.\d+\.\d+$/.test(ip)) return ip;
    } catch { /* try next */ }
  }

  // Fallback to local network IP
  const os = require('os');
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

// ── Step 5: Start the web server ───────────────────────────────────────────
async function main() {
  const port = process.env.WEB_PORT || 3000;

  console.log('\n🌐 Starting SuperClaw Web UI...');
  console.log('   (Detecting public IP...)\n');

  const ip = await getPublicIP();

  console.log('\n' + '='.repeat(60));
  console.log('✅ SuperClaw Web Panel is ready!');
  console.log('='.repeat(60));
  console.log('\n🌐 Access from anywhere:');
  console.log(`   http://${ip}:${port}`);
  console.log('\n💻 Access locally (SSH tunnel):');
  console.log(`   http://localhost:${port}`);
  console.log('\n⚠️  If port ' + port + ' is blocked by firewall, run:');
  console.log(`   ufw allow ${port}/tcp    # Ubuntu/Debian`);
  console.log(`   firewall-cmd --add-port=${port}/tcp --permanent && firewall-cmd --reload  # CentOS`);
  console.log('\n📋 aaPanel users — add a reverse proxy site:');
  console.log('   1. aaPanel → Website → Add Site → Domain: superclaw.yourdomain.com');
  console.log('   2. Site Settings → Reverse Proxy → Target: http://127.0.0.1:' + port);
  console.log('   3. Access via: http://superclaw.yourdomain.com');
  console.log('\nPress Ctrl+C to stop the web server.\n');
  console.log('='.repeat(60) + '\n');

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
}

main().catch((err) => {
  console.error('❌ Startup error:', err.message);
  process.exit(1);
});
