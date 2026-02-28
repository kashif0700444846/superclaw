#!/usr/bin/env node
'use strict';

const { execSync, spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');
const https = require('https');

const projectDir = __dirname;

// ── ANSI color codes (no chalk dependency) ────────────────────────────────
const c = {
  reset:  '\x1b[0m',
  bright: '\x1b[1m',
  dim:    '\x1b[2m',
  green:  '\x1b[32m',
  yellow: '\x1b[33m',
  blue:   '\x1b[34m',
  cyan:   '\x1b[36m',
  red:    '\x1b[31m',
  magenta:'\x1b[35m',
  white:  '\x1b[37m',
};

function bold(s)    { return c.bright + s + c.reset; }
function green(s)   { return c.green  + s + c.reset; }
function yellow(s)  { return c.yellow + s + c.reset; }
function cyan(s)    { return c.cyan   + s + c.reset; }
function red(s)     { return c.red    + s + c.reset; }
function dim(s)     { return c.dim    + s + c.reset; }
function blue(s)    { return c.blue   + s + c.reset; }

// ── Environment detection ─────────────────────────────────────────────────
async function detectEnvironment() {
  function cmdExists(cmd) {
    try {
      // Try Unix `which` first, fall back to Windows `where`
      execSync(
        process.platform === 'win32'
          ? `where ${cmd} 2>nul`
          : `which ${cmd} 2>/dev/null`,
        { stdio: 'pipe' }
      );
      return true;
    } catch {
      return false;
    }
  }

  function dirExists(p) {
    try { return fs.statSync(p).isDirectory(); } catch { return false; }
  }

  function fileExists(p) {
    try { return fs.statSync(p).isFile(); } catch { return false; }
  }

  const platform  = process.platform; // 'linux' | 'darwin' | 'win32'
  const isWindows = platform === 'win32';
  const isLinux   = platform === 'linux';
  const isMac     = platform === 'darwin';

  // Android / Termux
  const isTermux = !!process.env.TERMUX_VERSION || dirExists('/data/data/com.termux');

  // Docker
  const isDocker = fileExists('/.dockerenv') || (() => {
    try { return fs.readFileSync('/proc/1/cgroup', 'utf8').includes('docker'); } catch { return false; }
  })();

  // Running as root (Linux/Mac only)
  const isRoot = !isWindows && typeof process.getuid === 'function' && process.getuid() === 0;

  // Hosting control panels
  const hasAaPanel   = dirExists('/www/server/panel') || dirExists('/www/server/nginx');
  const hasCpanel    = dirExists('/usr/local/cpanel');
  const hasPleskPanel = dirExists('/usr/local/psa');

  // Web servers
  const hasNginx  = cmdExists('nginx');
  const hasApache = cmdExists('apache2') || cmdExists('httpd');

  // Process managers
  const hasPm2     = cmdExists('pm2');
  const hasSystemd = isLinux && !isTermux && cmdExists('systemctl');

  // Package managers
  const hasPnpm = cmdExists('pnpm');
  const hasNpm  = cmdExists('npm');
  const hasYarn = cmdExists('yarn');

  // Determine high-level environment type
  let envType;
  if      (isTermux)                    envType = 'termux';
  else if (isDocker)                    envType = 'docker';
  else if (isWindows)                   envType = 'windows';
  else if (isMac)                       envType = 'macos';
  else if (isLinux && hasAaPanel)       envType = 'vps-aapanel';
  else if (isLinux && hasCpanel)        envType = 'vps-cpanel';
  else if (isLinux && hasPleskPanel)    envType = 'vps-plesk';
  else if (isLinux)                     envType = 'vps-linux';
  else                                  envType = 'unknown';

  return {
    envType, platform, isTermux, isDocker, isLinux, isMac, isWindows,
    isRoot, hasAaPanel, hasCpanel, hasPleskPanel, hasNginx, hasApache,
    hasPm2, hasSystemd, hasPnpm, hasNpm, hasYarn,
    packageManager: hasPnpm ? 'pnpm' : hasYarn ? 'yarn' : 'npm',
  };
}

// ── Public IP detection ───────────────────────────────────────────────────
async function getPublicIP() {
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

// ── Human-readable environment label ─────────────────────────────────────
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

// ── Environment-specific access instructions ──────────────────────────────
function printAccessInstructions(env, ip, port) {
  const sep = '='.repeat(60);
  console.log('\n' + sep);
  console.log(bold(green('✅ SuperClaw Web Panel is ready!')));
  console.log(sep);

  switch (env.envType) {
    case 'termux':
      console.log('\n' + bold('📱 Running on Android (Termux)'));
      console.log(`   ${cyan('Access from your phone:')}  http://localhost:${port}`);
      console.log(`   ${cyan('Access from other devices:')} http://${ip}:${port}`);
      console.log('');
      console.log(yellow('   Note: Make sure Termux is not in battery optimization'));
      break;

    case 'vps-aapanel':
      console.log('\n' + bold('🖥️  Running on VPS (aaPanel detected)'));
      console.log(`   ${cyan('Direct access:')} http://${ip}:${port}`);
      console.log('');
      console.log('   To use a domain ' + dim('(recommended)') + ':');
      console.log('   1. aaPanel → Website → Add Site → Domain: superclaw.yourdomain.com');
      console.log(`   2. Site Settings → Reverse Proxy → Target: http://127.0.0.1:${port}`);
      console.log('   3. Access via: http://superclaw.yourdomain.com');
      console.log('');
      console.log(`   ${yellow('Firewall:')} aaPanel → Security → Firewall → Add port ${port}`);
      break;

    case 'vps-cpanel':
      console.log('\n' + bold('🖥️  Running on VPS (cPanel detected)'));
      console.log(`   ${cyan('Direct access:')} http://${ip}:${port}`);
      console.log('');
      console.log('   To use a domain: Set up a reverse proxy in cPanel → Apache Configuration');
      console.log(`   Or use SSH tunnel: ${dim(`ssh -L ${port}:localhost:${port} user@your-server`)}`);
      break;

    case 'vps-plesk':
      console.log('\n' + bold('🖥️  Running on VPS (Plesk detected)'));
      console.log(`   ${cyan('Direct access:')} http://${ip}:${port}`);
      console.log('');
      console.log('   To use a domain: Plesk → Websites & Domains → Add Subdomain → Proxy Rules');
      console.log(`   Target: http://127.0.0.1:${port}`);
      break;

    case 'vps-linux':
      console.log('\n' + bold('🖥️  Running on VPS (Linux)'));
      console.log(`   ${cyan('Direct access:')} http://${ip}:${port}`);
      console.log('');
      console.log(`   ${yellow('If port ' + port + ' is blocked:')}`);
      console.log(`   ${dim('ufw allow ' + port + '/tcp')}    ${dim('(Ubuntu/Debian)')}`);
      console.log(`   ${dim('firewall-cmd --add-port=' + port + '/tcp --permanent && firewall-cmd --reload')}  ${dim('(CentOS/RHEL)')}`);
      console.log('');
      console.log('   To use Nginx reverse proxy:');
      console.log('   Copy the Nginx config from the web panel → Nginx/aaPanel section');
      break;

    case 'docker':
      console.log('\n' + bold('🐳 Running in Docker'));
      console.log(`   ${cyan('Access:')} http://localhost:${port}`);
      console.log(`   Make sure port ${port} is mapped: ${dim('docker run -p ' + port + ':' + port + ' ...')}`);
      break;

    case 'macos':
      console.log('\n' + bold('🍎 Running on macOS'));
      console.log(`   ${cyan('Access:')} http://localhost:${port}`);
      console.log('');
      console.log('   To access from other devices on your network:');
      console.log(`   http://${ip}:${port}`);
      break;

    case 'windows':
      console.log('\n' + bold('🪟 Running on Windows'));
      console.log(`   ${cyan('Access:')} http://localhost:${port}`);
      console.log('');
      console.log('   To access from other devices:');
      console.log(`   1. Windows Firewall → Allow port ${port}`);
      console.log(`   2. http://${ip}:${port}`);
      break;

    default:
      console.log('\n' + bold('🌐 SuperClaw is running'));
      console.log(`   ${cyan('Local:')}  http://localhost:${port}`);
      console.log(`   ${cyan('Remote:')} http://${ip}:${port}`);
      break;
  }

  console.log('\n' + dim('Press Ctrl+C to stop the web server.'));
  console.log(sep + '\n');
}

// ── PM2 / daemon tip ──────────────────────────────────────────────────────
function printDaemonTip(env) {
  const isVps = ['vps-linux', 'vps-aapanel', 'vps-cpanel', 'vps-plesk'].includes(env.envType);

  if (env.isTermux) {
    console.log(yellow('💡 Tip: To keep SuperClaw running in background:'));
    console.log('   Install Termux:Boot from F-Droid, then run: superclaw daemon install');
  } else if (isVps && env.hasPm2) {
    console.log(yellow('💡 Tip: To keep SuperClaw running after you close this terminal:'));
    console.log('   pm2 start ecosystem.config.js');
    console.log('   pm2 save');
    console.log('   pm2 startup   ' + dim('← run the command it outputs to auto-start on reboot'));
  } else if (isVps && env.hasSystemd) {
    console.log(yellow('💡 Tip: To keep SuperClaw running as a service:'));
    console.log('   sudo systemctl enable superclaw');
    console.log('   sudo systemctl start superclaw');
  } else if (isVps) {
    console.log(yellow('💡 Tip: To keep SuperClaw running after you close this terminal:'));
    console.log('   npm install -g pm2');
    console.log('   pm2 start ecosystem.config.js');
    console.log('   pm2 save && pm2 startup');
  }
}

// ── Main ──────────────────────────────────────────────────────────────────
async function main() {
  // ── 1. Banner ────────────────────────────────────────────────────────────
  console.log(bold(cyan('\n🦀 SuperClaw Quickstart')));
  console.log(cyan('=======================\n'));

  // ── 2. Check Node.js version ─────────────────────────────────────────────
  const nodeVersion = parseInt(process.version.slice(1).split('.')[0], 10);
  if (nodeVersion < 18) {
    console.error(red('❌ Node.js 18+ required. Current: ' + process.version));
    process.exit(1);
  }
  console.log(green('✅ Node.js ' + process.version));

  // ── 3. Detect environment ─────────────────────────────────────────────────
  let env;
  try {
    env = await detectEnvironment();
  } catch (err) {
    // If detection fails, use safe defaults
    console.warn(yellow('⚠️  Environment detection failed, using defaults: ' + err.message));
    env = {
      envType: 'unknown', platform: process.platform,
      isTermux: false, isDocker: false, isLinux: process.platform === 'linux',
      isMac: process.platform === 'darwin', isWindows: process.platform === 'win32',
      isRoot: false, hasAaPanel: false, hasCpanel: false, hasPleskPanel: false,
      hasNginx: false, hasApache: false, hasPm2: false, hasSystemd: false,
      hasPnpm: false, hasNpm: true, hasYarn: false, packageManager: 'npm',
    };
  }

  // ── 4. Print environment summary ──────────────────────────────────────────
  const label = envLabel(env);
  const pm2Tick    = env.hasPm2     ? green('✓') : dim('✗');
  const nginxTick  = env.hasNginx   ? green('✓') : dim('✗');
  const rootLabel  = env.isRoot     ? yellow(' | Root: ✓') : '';

  console.log('\n' + bold('🔍 Detected environment: ') + cyan(label));
  console.log(
    dim('   Platform: ') + env.platform +
    dim(' | Package manager: ') + env.packageManager +
    dim(' | PM2: ') + pm2Tick +
    dim(' | Nginx: ') + nginxTick +
    rootLabel
  );

  // ── 5. Install dependencies if needed ────────────────────────────────────
  const nodeModulesExist = fs.existsSync(path.join(projectDir, 'node_modules', 'express'));
  if (!nodeModulesExist) {
    console.log('\n' + bold('📦 Installing dependencies...'));

    // Choose install command based on detected package manager and environment
    const installCmd = env.hasPnpm
      ? (env.isTermux ? 'pnpm install --no-optional' : 'pnpm install')
      : (env.isTermux ? 'npm install --omit=optional' : 'npm install');

    try {
      execSync(installCmd, { stdio: 'inherit', cwd: projectDir });
      console.log(green('✅ Dependencies installed'));
    } catch (err) {
      // Fallback: if pnpm failed, try npm
      if (env.hasPnpm) {
        console.warn(yellow('⚠️  pnpm install failed, falling back to npm...'));
        try {
          const fallback = env.isTermux ? 'npm install --omit=optional' : 'npm install';
          execSync(fallback, { stdio: 'inherit', cwd: projectDir });
          console.log(green('✅ Dependencies installed (via npm fallback)'));
        } catch (err2) {
          console.error(red('❌ Failed to install dependencies: ' + err2.message));
          process.exit(1);
        }
      } else {
        console.error(red('❌ Failed to install dependencies: ' + err.message));
        process.exit(1);
      }
    }
  } else {
    console.log(green('✅ Dependencies already installed'));
  }

  // ── 6. Build TypeScript (skip if dist is fresh) ───────────────────────────
  const distIndexPath = path.join(projectDir, 'dist', 'index.js');
  const webServerDist = path.join(projectDir, 'dist', 'web', 'WebServer.js');
  const srcDir        = path.join(projectDir, 'src');

  let needsBuild = true;

  if (fs.existsSync(distIndexPath) && fs.existsSync(webServerDist)) {
    try {
      const srcStat  = fs.statSync(srcDir);
      const distStat = fs.statSync(distIndexPath);
      if (srcStat.mtimeMs < distStat.mtimeMs) {
        console.log(green('✅ Build is up to date, skipping...'));
        needsBuild = false;
      }
    } catch {
      // If stat fails, rebuild to be safe
      needsBuild = true;
    }
  }

  if (needsBuild) {
    console.log('\n' + bold('🔨 Building TypeScript...'));

    const buildCmd = env.hasPnpm ? 'pnpm build' : 'npm run build';

    try {
      execSync(buildCmd, { stdio: 'inherit', cwd: projectDir });
      console.log(green('✅ Build complete'));
    } catch {
      // Fallback: try npx tsc directly
      try {
        execSync('npx tsc', { stdio: 'inherit', cwd: projectDir });
        console.log(green('✅ Build complete (via npx tsc)'));
      } catch (err2) {
        console.error(red('❌ Build failed: ' + err2.message));
        console.error(red('   Try running: npm run build'));
        process.exit(1);
      }
    }
  }

  // ── 7. Get public IP ──────────────────────────────────────────────────────
  const port = process.env.WEB_PORT || 3000;

  console.log('\n' + bold('🌐 Starting SuperClaw Web UI...'));
  console.log(dim('   (Detecting public IP...)'));

  let ip = 'localhost';
  try {
    ip = await getPublicIP();
  } catch {
    // Non-fatal — fall back to localhost
  }

  // ── 8. Start web server ───────────────────────────────────────────────────
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
    console.error(red('❌ Failed to start web server: ' + err.message));
    process.exit(1);
  });

  child.on('exit', (code) => {
    process.exit(code || 0);
  });

  // Forward signals to child
  process.on('SIGINT',  () => { child.kill('SIGINT');  });
  process.on('SIGTERM', () => { child.kill('SIGTERM'); });

  // ── 9. Print environment-specific access instructions ─────────────────────
  printAccessInstructions(env, ip, port);

  // ── 10. Print PM2 / daemon tip ────────────────────────────────────────────
  printDaemonTip(env);
}

main().catch((err) => {
  console.error(red('❌ Quickstart failed: ' + err.message));
  process.exit(1);
});
