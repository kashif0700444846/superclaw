import 'dotenv/config';
import express, { Request, Response, NextFunction } from 'express';
import * as http from 'http';
import * as path from 'path';
import * as fs from 'fs';
import * as crypto from 'crypto';
import { execSync, spawn, exec } from 'child_process';

// ─── Logger (standalone so WebServer works without full agent stack) ──────────
const logPrefix = '[WebServer]';
function log(level: 'info' | 'warn' | 'error', msg: string, meta?: object): void {
  const ts = new Date().toISOString();
  const metaStr = meta ? ' ' + JSON.stringify(meta) : '';
  console[level === 'error' ? 'error' : level === 'warn' ? 'warn' : 'log'](
    `${ts} ${level.toUpperCase()} ${logPrefix} ${msg}${metaStr}`
  );
}

// ─── Paths ────────────────────────────────────────────────────────────────────
const PROJECT_ROOT = path.resolve(__dirname, '..', '..');
const ENV_PATH = path.join(PROJECT_ROOT, '.env');
const SUPERCLAW_CONFIG_PATH = path.join(PROJECT_ROOT, 'superclaw.config.json');
const LOG_PATH = path.join(PROJECT_ROOT, 'logs', 'app.log');

// Public dir: prefer dist/web/public (production), fall back to src/web/public (dev)
function resolvePublicDir(): string {
  const distPublic = path.join(__dirname, 'public');
  if (fs.existsSync(distPublic)) return distPublic;
  // When running from dist/, __dirname is dist/web — go up to project root then into src/web/public
  const srcPublic = path.join(PROJECT_ROOT, 'src', 'web', 'public');
  if (fs.existsSync(srcPublic)) return srcPublic;
  return distPublic; // default even if missing
}
const PUBLIC_DIR = resolvePublicDir();

// ─── Password helpers (crypto.scrypt — no bcrypt needed) ─────────────────────
async function hashPassword(password: string): Promise<string> {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = await new Promise<Buffer>((resolve, reject) => {
    crypto.scrypt(password, salt, 64, (err, key) => (err ? reject(err) : resolve(key)));
  });
  return `${salt}:${hash.toString('hex')}`;
}

async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split(':');
  if (parts.length !== 2) return false;
  const [salt, hash] = parts;
  const keyBuffer = await new Promise<Buffer>((resolve, reject) => {
    crypto.scrypt(password, salt, 64, (err, key) => (err ? reject(err) : resolve(key)));
  });
  return keyBuffer.toString('hex') === hash;
}

// ─── Session store ────────────────────────────────────────────────────────────
interface Session {
  createdAt: number;
  expiresAt: number;
}
const sessions = new Map<string, Session>();
const SESSION_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

function createToken(): string {
  return crypto.randomBytes(32).toString('hex');
}

function isValidToken(token: string): boolean {
  const session = sessions.get(token);
  if (!session) return false;
  if (Date.now() > session.expiresAt) {
    sessions.delete(token);
    return false;
  }
  return true;
}

// Cleanup expired sessions every hour
setInterval(() => {
  const now = Date.now();
  for (const [token, session] of sessions.entries()) {
    if (now > session.expiresAt) sessions.delete(token);
  }
}, 60 * 60 * 1000);

// ─── .env helpers ─────────────────────────────────────────────────────────────
function readEnvFile(): Record<string, string> {
  if (!fs.existsSync(ENV_PATH)) return {};
  const lines = fs.readFileSync(ENV_PATH, 'utf-8').split('\n');
  const result: Record<string, string> = {};
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx === -1) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    const value = trimmed.slice(eqIdx + 1).trim().replace(/^["']|["']$/g, '');
    result[key] = value;
  }
  return result;
}

function writeEnvFile(data: Record<string, string>): void {
  const lines: string[] = [];
  for (const [key, value] of Object.entries(data)) {
    // Quote values that contain spaces or special chars
    const needsQuote = /[\s#"'\\]/.test(value);
    lines.push(`${key}=${needsQuote ? `"${value.replace(/"/g, '\\"')}"` : value}`);
  }
  fs.writeFileSync(ENV_PATH, lines.join('\n') + '\n', 'utf-8');
}

function setEnvKey(key: string, value: string): void {
  const data = readEnvFile();
  data[key] = value;
  writeEnvFile(data);
  // Also update process.env for current session
  process.env[key] = value;
}

function maskSecret(value: string): string {
  if (!value || value.length < 8) return '***';
  return value.slice(0, 3) + '...' + value.slice(-3);
}

// ─── Auth middleware ──────────────────────────────────────────────────────────
function requireAuth(req: Request, res: Response, next: NextFunction): void {
  const authHeader = req.headers['authorization'];
  const cookieToken = req.cookies?.token as string | undefined;
  let token: string | undefined;

  if (authHeader && authHeader.startsWith('Bearer ')) {
    token = authHeader.slice(7);
  } else if (cookieToken) {
    token = cookieToken;
  }

  if (!token || !isValidToken(token)) {
    res.status(401).json({ success: false, error: 'Unauthorized' });
    return;
  }
  next();
}

// ─── Process management helpers ───────────────────────────────────────────────
function isPm2Available(): boolean {
  try {
    execSync('pm2 --version', { stdio: 'pipe' });
    return true;
  } catch {
    return false;
  }
}

function getUptime(): number {
  return process.uptime();
}

function getRamUsageMb(): number {
  const mem = process.memoryUsage();
  return Math.round(mem.rss / 1024 / 1024);
}

function getVersion(): string {
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(PROJECT_ROOT, 'package.json'), 'utf-8'));
    return pkg.version || '0.0.0';
  } catch {
    return '0.0.0';
  }
}

// ─── Git helpers ──────────────────────────────────────────────────────────────
function getCurrentCommit(): string {
  try {
    return execSync('git rev-parse HEAD', { cwd: PROJECT_ROOT, stdio: 'pipe' }).toString().trim();
  } catch {
    return 'unknown';
  }
}

function getLatestRemoteCommit(): string {
  try {
    return execSync('git ls-remote origin HEAD', { cwd: PROJECT_ROOT, stdio: 'pipe' })
      .toString()
      .split('\t')[0]
      .trim();
  } catch {
    return 'unknown';
  }
}

// ─── Log tail helper (Windows-compatible) ────────────────────────────────────
function getLastLogLines(n: number): string {
  if (!fs.existsSync(LOG_PATH)) return '';
  try {
    const content = fs.readFileSync(LOG_PATH, 'utf-8');
    const lines = content.split('\n').filter((l) => l.trim());
    return lines.slice(-n).join('\n');
  } catch {
    return '';
  }
}

// ─── Build the Express app ────────────────────────────────────────────────────
export function createWebApp(): express.Application {
  const app = express();

  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));

  // Simple cookie parser (no dependency)
  app.use((req: Request, _res: Response, next: NextFunction) => {
    const cookieHeader = req.headers.cookie || '';
    const cookies: Record<string, string> = {};
    cookieHeader.split(';').forEach((part) => {
      const [k, ...v] = part.trim().split('=');
      if (k) cookies[k.trim()] = decodeURIComponent(v.join('='));
    });
    (req as any).cookies = cookies;
    next();
  });

  // Serve static files
  if (fs.existsSync(PUBLIC_DIR)) {
    app.use(express.static(PUBLIC_DIR));
  }

  // ── Health (no auth) ────────────────────────────────────────────────────────
  app.get('/api/health', (_req: Request, res: Response) => {
    res.json({ ok: true });
  });

  // ── Status (no auth — needed for setup detection) ──────────────────────────
  app.get('/api/status', (_req: Request, res: Response) => {
    const envData = readEnvFile();
    const configured = !!(envData['WEB_PASSWORD_HASH'] || process.env['WEB_PASSWORD_HASH']);
    res.json({
      configured,
      running: true,
      version: getVersion(),
      uptime: getUptime(),
      ram: getRamUsageMb(),
      agentName: envData['AGENT_NAME'] || process.env['AGENT_NAME'] || 'SuperClaw',
    });
  });

  // ── Auth: Login ─────────────────────────────────────────────────────────────
  app.post('/api/auth/login', async (req: Request, res: Response) => {
    const { password } = req.body as { password?: string };
    if (!password) {
      res.status(400).json({ success: false, error: 'Password required' });
      return;
    }

    const envData = readEnvFile();
    const storedHash = envData['WEB_PASSWORD_HASH'] || process.env['WEB_PASSWORD_HASH'] || '';

    // If no password set yet — first-time setup mode, any password works
    let valid = false;
    if (!storedHash) {
      valid = true;
    } else {
      valid = await verifyPassword(password, storedHash);
    }

    if (!valid) {
      res.status(401).json({ success: false, error: 'Invalid password' });
      return;
    }

    const token = createToken();
    sessions.set(token, {
      createdAt: Date.now(),
      expiresAt: Date.now() + SESSION_TTL_MS,
    });

    res.json({ success: true, token });
  });

  // ── Auth: Logout ────────────────────────────────────────────────────────────
  app.post('/api/auth/logout', requireAuth, (req: Request, res: Response) => {
    const authHeader = req.headers['authorization'];
    if (authHeader && authHeader.startsWith('Bearer ')) {
      sessions.delete(authHeader.slice(7));
    }
    res.json({ success: true });
  });

  // ── Config: GET ─────────────────────────────────────────────────────────────
  app.get('/api/config', requireAuth, (_req: Request, res: Response) => {
    const envData = readEnvFile();
    const SECRET_KEYS = [
      'OPENAI_API_KEY',
      'ANTHROPIC_API_KEY',
      'GROQ_API_KEY',
      'CUSTOM_AI_API_KEY',
      'SERPAPI_KEY',
      'TELEGRAM_BOT_TOKEN',
      'WEB_PASSWORD_HASH',
    ];
    const sanitized: Record<string, string> = {};
    for (const [key, value] of Object.entries(envData)) {
      if (SECRET_KEYS.includes(key) && value) {
        sanitized[key] = maskSecret(value);
      } else {
        sanitized[key] = value;
      }
    }
    res.json({ success: true, config: sanitized });
  });

  // ── Config: POST (update single key) ───────────────────────────────────────
  app.post('/api/config', requireAuth, async (req: Request, res: Response) => {
    const { key, value } = req.body as { key?: string; value?: string };
    if (!key) {
      res.status(400).json({ success: false, error: 'key required' });
      return;
    }

    // Special handling for password update
    if (key === 'WEB_PASSWORD') {
      if (!value || value.length < 6) {
        res.status(400).json({ success: false, error: 'Password must be at least 6 characters' });
        return;
      }
      const hash = await hashPassword(value);
      setEnvKey('WEB_PASSWORD_HASH', hash);
      res.json({ success: true, message: 'Password updated' });
      return;
    }

    setEnvKey(key, value || '');
    res.json({ success: true });
  });

  // ── SuperClaw config: GET ───────────────────────────────────────────────────
  app.get('/api/superclaw-config', requireAuth, (_req: Request, res: Response) => {
    try {
      if (!fs.existsSync(SUPERCLAW_CONFIG_PATH)) {
        res.json({ success: true, config: null });
        return;
      }
      const config = JSON.parse(fs.readFileSync(SUPERCLAW_CONFIG_PATH, 'utf-8'));
      res.json({ success: true, config });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // ── SuperClaw config: POST ──────────────────────────────────────────────────
  app.post('/api/superclaw-config', requireAuth, (req: Request, res: Response) => {
    const { config } = req.body as { config?: object };
    if (!config) {
      res.status(400).json({ success: false, error: 'config required' });
      return;
    }
    try {
      fs.writeFileSync(SUPERCLAW_CONFIG_PATH, JSON.stringify(config, null, 2), 'utf-8');
      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // ── Logs: GET last 100 lines ────────────────────────────────────────────────
  app.get('/api/logs', requireAuth, (_req: Request, res: Response) => {
    const lines = getLastLogLines(100);
    res.json({ success: true, logs: lines });
  });

  // ── Logs: SSE stream ────────────────────────────────────────────────────────
  app.get('/api/logs/stream', requireAuth, (req: Request, res: Response) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.flushHeaders();

    // Send initial lines
    const initial = getLastLogLines(50);
    if (initial) {
      res.write(`data: ${JSON.stringify(initial)}\n\n`);
    }

    // Try tail -f (Linux/Mac), fall back to polling on Windows
    const isWindows = process.platform === 'win32';
    let cleanup: (() => void) | null = null;

    if (!isWindows && fs.existsSync(LOG_PATH)) {
      try {
        const tail = spawn('tail', ['-f', '-n', '0', LOG_PATH]);
        tail.stdout.on('data', (data: Buffer) => {
          res.write(`data: ${JSON.stringify(data.toString())}\n\n`);
        });
        tail.stderr.on('data', () => {/* ignore */});
        cleanup = () => { try { tail.kill(); } catch { /* ignore */ } };
      } catch {
        // Fall through to polling
      }
    }

    if (!cleanup) {
      // Polling fallback (Windows or if tail fails)
      let lastSize = 0;
      try {
        if (fs.existsSync(LOG_PATH)) {
          lastSize = fs.statSync(LOG_PATH).size;
        }
      } catch { /* ignore */ }

      const interval = setInterval(() => {
        try {
          if (!fs.existsSync(LOG_PATH)) return;
          const stat = fs.statSync(LOG_PATH);
          if (stat.size > lastSize) {
            const fd = fs.openSync(LOG_PATH, 'r');
            const buf = Buffer.alloc(stat.size - lastSize);
            fs.readSync(fd, buf, 0, buf.length, lastSize);
            fs.closeSync(fd);
            lastSize = stat.size;
            res.write(`data: ${JSON.stringify(buf.toString('utf-8'))}\n\n`);
          }
        } catch { /* ignore */ }
      }, 1000);

      cleanup = () => clearInterval(interval);
    }

    // Heartbeat to keep connection alive
    const heartbeat = setInterval(() => {
      res.write(': heartbeat\n\n');
    }, 15000);

    req.on('close', () => {
      clearInterval(heartbeat);
      if (cleanup) cleanup();
    });
  });

  // ── Process: Restart ────────────────────────────────────────────────────────
  app.post('/api/restart', requireAuth, (_req: Request, res: Response) => {
    res.json({ success: true, message: 'Restart initiated' });
    setTimeout(() => {
      if (isPm2Available()) {
        try { execSync('pm2 restart superclaw', { cwd: PROJECT_ROOT }); } catch { /* ignore */ }
      } else {
        process.exit(0); // PM2/supervisor will restart
      }
    }, 500);
  });

  // ── Process: Stop ───────────────────────────────────────────────────────────
  app.post('/api/stop', requireAuth, (_req: Request, res: Response) => {
    if (isPm2Available()) {
      try {
        execSync('pm2 stop superclaw', { cwd: PROJECT_ROOT });
        res.json({ success: true, message: 'Stopped' });
      } catch (err: any) {
        res.status(500).json({ success: false, error: err.message });
      }
    } else {
      res.json({ success: true, message: 'Stop signal sent' });
      setTimeout(() => process.exit(0), 500);
    }
  });

  // ── Process: Start ──────────────────────────────────────────────────────────
  app.post('/api/start', requireAuth, (_req: Request, res: Response) => {
    if (isPm2Available()) {
      try {
        const ecoPath = path.join(PROJECT_ROOT, 'ecosystem.config.js');
        if (fs.existsSync(ecoPath)) {
          execSync(`pm2 start ${ecoPath}`, { cwd: PROJECT_ROOT });
        } else {
          execSync('pm2 start superclaw', { cwd: PROJECT_ROOT });
        }
        res.json({ success: true, message: 'Started' });
      } catch (err: any) {
        res.status(500).json({ success: false, error: err.message });
      }
    } else {
      res.json({ success: false, error: 'PM2 not available. Start manually with: node dist/index.js' });
    }
  });

  // ── Admins: GET ─────────────────────────────────────────────────────────────
  app.get('/api/admins', requireAuth, (_req: Request, res: Response) => {
    const envData = readEnvFile();
    const raw = envData['ADMIN_TELEGRAM_ID'] || '';
    const ids = raw.split(',').map((s) => s.trim()).filter(Boolean);
    res.json({ success: true, admins: ids });
  });

  // ── Admins: POST (add) ──────────────────────────────────────────────────────
  app.post('/api/admins', requireAuth, (req: Request, res: Response) => {
    const { id } = req.body as { id?: string };
    if (!id) {
      res.status(400).json({ success: false, error: 'id required' });
      return;
    }
    const envData = readEnvFile();
    const raw = envData['ADMIN_TELEGRAM_ID'] || '';
    const ids = raw.split(',').map((s) => s.trim()).filter(Boolean);
    if (!ids.includes(id)) {
      ids.push(id);
      setEnvKey('ADMIN_TELEGRAM_ID', ids.join(','));
    }
    res.json({ success: true, admins: ids });
  });

  // ── Admins: DELETE ──────────────────────────────────────────────────────────
  app.delete('/api/admins/:id', requireAuth, (req: Request, res: Response) => {
    const { id } = req.params;
    const envData = readEnvFile();
    const raw = envData['ADMIN_TELEGRAM_ID'] || '';
    const ids = raw.split(',').map((s) => s.trim()).filter((s) => s && s !== id);
    setEnvKey('ADMIN_TELEGRAM_ID', ids.join(','));
    res.json({ success: true, admins: ids });
  });

  // ── Update: Check ───────────────────────────────────────────────────────────
  app.get('/api/update/check', requireAuth, (_req: Request, res: Response) => {
    try {
      const current = getCurrentCommit();
      const latest = getLatestRemoteCommit();
      res.json({
        success: true,
        hasUpdate: current !== latest && latest !== 'unknown',
        currentVersion: getVersion(),
        currentCommit: current,
        latestCommit: latest,
      });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // ── Update: Apply ───────────────────────────────────────────────────────────
  app.post('/api/update/apply', requireAuth, (req: Request, res: Response) => {
    res.json({ success: true, message: 'Update started. Check logs for progress.' });

    // Run update in background
    const updateScript = path.join(PROJECT_ROOT, 'update.sh');
    if (fs.existsSync(updateScript)) {
      exec(`bash ${updateScript}`, { cwd: PROJECT_ROOT }, (err) => {
        if (err) log('error', 'Update failed', { error: err.message });
        else log('info', 'Update completed');
      });
    } else {
      // Manual update steps
      exec(
        'git pull && npm install && npm run build',
        { cwd: PROJECT_ROOT },
        (err) => {
          if (err) log('error', 'Update failed', { error: err.message });
          else {
            log('info', 'Update completed, restarting...');
            if (isPm2Available()) {
              try { execSync('pm2 restart superclaw', { cwd: PROJECT_ROOT }); } catch { /* ignore */ }
            }
          }
        }
      );
    }
  });

  // ── Setup: Complete ─────────────────────────────────────────────────────────
  app.post('/api/setup/complete', async (req: Request, res: Response) => {
    const {
      webPassword,
      aiProvider,
      apiKey,
      model,
      telegramToken,
      adminIds,
      agentName,
      whatsappEnabled,
      whatsappDriver,
      ollamaBaseUrl,
      customAiBaseUrl,
      customAiModel,
    } = req.body as {
      webPassword?: string;
      aiProvider?: string;
      apiKey?: string;
      model?: string;
      telegramToken?: string;
      adminIds?: string;
      agentName?: string;
      whatsappEnabled?: boolean;
      whatsappDriver?: string;
      ollamaBaseUrl?: string;
      customAiBaseUrl?: string;
      customAiModel?: string;
    };

    try {
      // Read existing .env or start fresh
      const envData = readEnvFile();

      // Set web password
      if (webPassword && webPassword.length >= 6) {
        const hash = await hashPassword(webPassword);
        envData['WEB_PASSWORD_HASH'] = hash;
      }

      // AI provider
      if (aiProvider) envData['AI_PROVIDER'] = aiProvider;
      if (model) envData['AI_MODEL'] = model;
      if (agentName) envData['AGENT_NAME'] = agentName;

      // API keys by provider
      if (apiKey) {
        switch (aiProvider) {
          case 'openai': envData['OPENAI_API_KEY'] = apiKey; break;
          case 'anthropic': envData['ANTHROPIC_API_KEY'] = apiKey; break;
          case 'groq': envData['GROQ_API_KEY'] = apiKey; break;
          case 'custom': envData['CUSTOM_AI_API_KEY'] = apiKey; break;
        }
      }
      if (ollamaBaseUrl) envData['OLLAMA_BASE_URL'] = ollamaBaseUrl;
      if (customAiBaseUrl) envData['CUSTOM_AI_BASE_URL'] = customAiBaseUrl;
      if (customAiModel) envData['CUSTOM_AI_MODEL'] = customAiModel;

      // Telegram
      if (telegramToken) envData['TELEGRAM_BOT_TOKEN'] = telegramToken;
      if (adminIds) envData['ADMIN_TELEGRAM_ID'] = adminIds;

      // Defaults
      if (!envData['LOG_LEVEL']) envData['LOG_LEVEL'] = 'info';
      if (!envData['DB_PATH']) envData['DB_PATH'] = './data/superclaw.db';
      if (!envData['MAX_MESSAGES_PER_MINUTE']) envData['MAX_MESSAGES_PER_MINUTE'] = '30';
      if (!envData['MAX_AI_CALLS_PER_MINUTE']) envData['MAX_AI_CALLS_PER_MINUTE'] = '10';
      if (!envData['WEB_ENABLED']) envData['WEB_ENABLED'] = 'true';

      writeEnvFile(envData);

      // Write superclaw.config.json
      const platforms: string[] = [];
      if (telegramToken && telegramToken !== 'DISABLED') platforms.push('telegram');
      if (whatsappEnabled) platforms.push('whatsapp');

      const scConfig = {
        schemaVersion: 1,
        platforms,
        whatsappDriver: whatsappDriver || 'baileys',
        enabledTools: [
          'shell_execute', 'file_read', 'file_write', 'file_list',
          'http_request', 'system_info', 'memory_read', 'memory_write',
          'clear_history', 'web_search', 'process_manager',
        ],
        disabledTools: [],
        estimatedRamMb: whatsappEnabled && whatsappDriver === 'puppeteer' ? 700 : 150,
        generatedAt: new Date().toISOString(),
      };

      fs.writeFileSync(SUPERCLAW_CONFIG_PATH, JSON.stringify(scConfig, null, 2), 'utf-8');

      res.json({ success: true, message: 'Setup complete! You can now log in.' });
    } catch (err: any) {
      log('error', 'Setup failed', { error: err.message });
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // ── Catch-all: serve index.html for SPA routing ─────────────────────────────
  app.get('*', (_req: Request, res: Response) => {
    const indexPath = path.join(PUBLIC_DIR, 'index.html');
    if (fs.existsSync(indexPath)) {
      res.sendFile(indexPath);
    } else {
      res.status(404).send('Web UI not found. Run `npm run build` first.');
    }
  });

  return app;
}

// ─── Start server (standalone entry point) ────────────────────────────────────
export async function startWebServer(port?: number): Promise<http.Server> {
  const app = createWebApp();
  const webPort = port || parseInt(process.env['WEB_PORT'] || '3000', 10);

  return new Promise((resolve, reject) => {
    const server = http.createServer(app);
    server.listen(webPort, '0.0.0.0', () => {
      log('info', `Web server listening on http://0.0.0.0:${webPort}`);
      resolve(server);
    });
    server.on('error', reject);
  });
}

// ─── Standalone entry point ───────────────────────────────────────────────────
if (require.main === module) {
  const port = parseInt(process.env['WEB_PORT'] || '3000', 10);
  startWebServer(port).then(() => {
    log('info', `SuperClaw Web UI running at http://localhost:${port}`);
  }).catch((err) => {
    console.error('Failed to start web server:', err);
    process.exit(1);
  });
}
