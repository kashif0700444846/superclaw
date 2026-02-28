# SuperClaw — AI Coding Agent Guide

This document provides essential information for AI coding agents working on the SuperClaw project.

## Project Overview

SuperClaw is a lightweight, self-hosted autonomous AI agent system designed to run on a VPS or Android (Termux). It connects to messaging platforms (Telegram, WhatsApp) and allows users to interact with an AI that can execute real actions on the server — run shell commands, manage files, search the web, install packages, and more.

**Key Characteristics:**
- **Language:** TypeScript (Node.js 20+)
- **Runtime:** ~80-120 MB RAM (Baileys/WhatsApp) or ~600 MB (Puppeteer/WhatsApp)
- **Storage:** SQLite for conversations, Markdown files for memory
- **Architecture:** Modular with pluggable platforms and tools
- **Platforms:** VPS (Linux), Android (Termux), Docker

## Project Structure

```
src/
├── index.ts                    # Entry point — initializes platforms and starts services
├── config.ts                   # Environment variable loading and validation
├── superclawConfig.ts          # Runtime feature flags from superclaw.config.json
├── logger.ts                   # Winston logger configuration
├── doctor.ts                   # Health check CLI (pnpm doctor)
├── types/SuperclawConfig.ts    # TypeScript types for configuration
├──
├── brain/                      # AI processing core
│   ├── Brain.ts                # Main message processing orchestrator
│   ├── FunctionCaller.ts       # AI provider abstraction (OpenAI, Anthropic, Groq, Ollama, Custom)
│   ├── PromptBuilder.ts        # System prompt construction
│   └── ToolRegistry.ts         # Tool registration and OpenAI function format conversion
├──
├── gateway/                    # Message routing layer
│   ├── Gateway.ts              # Central message broker between platforms and brain
│   └── types.ts                # Shared types (Tool, ToolResult, AgentConfig, etc.)
├──
├── platforms/                  # Messaging platform integrations
│   ├── TelegramPlatform.ts     # grammy-based Telegram bot
│   ├── WhatsAppBaileysPlatform.ts  # WebSocket-based WhatsApp (lightweight)
│   └── WhatsAppPlatform.ts     # Puppeteer-based WhatsApp (compatibility)
├──
├── memory/                     # Persistence layer
│   ├── ConversationDB.ts       # SQLite conversation history (better-sqlite3)
│   └── MemoryManager.ts        # File-based memory (MEMORY.md, SOUL.md, daily logs)
├──
├── agents/                     # Sub-agent system (parallel task execution)
│   ├── AgentOrchestrator.ts    # Spawns and manages child processes
│   ├── SubAgent.ts             # Child process entry point (runs as forked process)
│   ├── SubAgentToolRegistry.ts # Tool registry for sub-agents (subset of main tools)
│   ├── TaskStore.ts            # File-based task persistence (data/tasks/)
│   └── types.ts                # Sub-agent type definitions
├──
├── tools/                      # Tool implementations
│   ├── ShellTool.ts            # Execute shell commands (with destructive op confirmation)
│   ├── FileReadTool.ts         # Read files
│   ├── FileWriteTool.ts        # Write/create files
│   ├── FileListTool.ts         # List directories
│   ├── HttpRequestTool.ts      # HTTP requests
│   ├── PackageManagerTool.ts   # apt/npm/pip package management
│   ├── ServiceManagerTool.ts   # systemd service control
│   ├── CronManagerTool.ts      # cron job management
│   ├── ProcessManagerTool.ts   # Process listing/killing
│   ├── SystemInfoTool.ts       # System metrics (CPU, RAM, disk)
│   ├── MemoryReadTool.ts       # Read memory files
│   ├── MemoryWriteTool.ts      # Append to memory
│   ├── ClearHistoryTool.ts     # Clear conversation history
│   ├── AiQueryTool.ts          # Query AI for instructions
│   ├── WebSearchTool.ts        # Web search (SerpAPI/DuckDuckGo)
│   ├── CodeExecutorTool.ts     # Sandbox code execution
│   ├── BrowserAutomationTool.ts # Puppeteer browser automation
│   ├── SelfUpdateTool.ts       # Git pull and restart
│   ├── SelfModifyTool.ts       # Edit source files and rebuild
│   ├── SpawnAgentTool.ts       # Spawn parallel sub-agent
│   ├── CheckAgentTool.ts       # Check sub-agent status
│   ├── ListAgentsTool.ts       # List all sub-agents
│   ├── KillAgentTool.ts        # Terminate sub-agent
│   ├── TermuxApiTool.ts        # Termux:API integration (SMS, camera, location, etc.)
│   ├── RootShellTool.ts        # Root shell execution via su -c
│   ├── AndroidInfoTool.ts      # Android device information
│   └── DaemonManagerTool.ts    # Daemon/service management (Termux:Boot, systemd, PM2)
├──
└── setup/
    └── wizard.ts               # Interactive setup wizard (pnpm run setup)
```

## Technology Stack

| Component | Technology |
|-----------|------------|
| Runtime | Node.js 20+ |
| Language | TypeScript 5.3+ |
| Package Manager | pnpm |
| Process Manager | PM2 (production) |
| Database | SQLite (better-sqlite3) |
| Telegram | grammy |
| WhatsApp (light) | @whiskeysockets/baileys |
| WhatsApp (heavy) | whatsapp-web.js + Puppeteer |
| AI SDKs | openai, @anthropic-ai/sdk |
| Logging | winston |
| Build | tsc (TypeScript compiler) |
| Dev Runner | tsx |
| Containerization | Docker + docker-compose |

## Build and Development Commands

```bash
# Install dependencies
pnpm install

# Development (hot reload with tsx)
pnpm dev
# or directly
npx tsx src/index.ts

# Build TypeScript to dist/
pnpm build

# Run compiled version
pnpm start

# Type checking without emit
pnpm lint

# Setup wizard (interactive configuration)
pnpm setup
# or
npx tsx src/setup/wizard.ts

# Health check diagnostics
pnpm doctor
```

## Configuration Files

### Environment Variables (.env)

```bash
# AI Provider: openai | anthropic | groq | ollama | custom
AI_PROVIDER=openai
AI_MODEL=gpt-4o

# Fallback provider (optional — used when primary fails)
FALLBACK_AI_PROVIDER=groq
FALLBACK_AI_MODEL=llama3-70b-8192

# Retry / backoff settings
AI_MAX_RETRIES=3
AI_RETRY_DELAY_MS=1000

# API Keys (provider-specific)
OPENAI_API_KEY=sk-...
ANTHROPIC_API_KEY=sk-ant-...
GROQ_API_KEY=gsk_...
OLLAMA_BASE_URL=http://localhost:11434
CUSTOM_AI_BASE_URL=https://api.openrouter.ai/v1
CUSTOM_AI_MODEL=mistral-7b-instruct
CUSTOM_AI_API_KEY=...

# Platform Credentials
TELEGRAM_BOT_TOKEN=123456789:ABC...
ADMIN_TELEGRAM_ID=123456789
WHATSAPP_SESSION_NAME=superclaw
ADMIN_WHATSAPP_NUMBER=15551234567@c.us

# Agent Identity
AGENT_NAME=SuperClaw
VPS_HOSTNAME=my-vps

# Paths and Limits
LOG_LEVEL=info
DB_PATH=./data/superclaw.db
SERPAPI_KEY=                    # Optional, for web search
MAX_MESSAGES_PER_MINUTE=30
MAX_AI_CALLS_PER_MINUTE=10
MAX_CONCURRENT_TOOLS=5
MAX_CONCURRENT_AGENTS=5
SUBAGENT_TIMEOUT_MS=600000
```

### Runtime Configuration (superclaw.config.json)

Generated by the setup wizard. Controls which platforms and tools are enabled:

```json
{
  "schemaVersion": 1,
  "platforms": ["telegram", "whatsapp"],
  "whatsappDriver": "baileys",
  "enabledTools": ["shell_execute", "file_read", ...],
  "disabledTools": [],
  "estimatedRamMb": 150,
  "generatedAt": "2026-02-28T..."
}
```

## Tools Reference

| Tool | Description | Platform |
|------|-------------|----------|
| `shell_execute` | Run shell commands with destructive-op confirmation | Both |
| `file_read` | Read file contents | Both |
| `file_write` | Write or create files | Both |
| `file_list` | List directory contents | Both |
| `http_request` | Make HTTP GET/POST/PUT/DELETE requests | Both |
| `package_manager` | Install packages via apt, npm, or pip | Both |
| `service_manager` | Start/stop/restart systemd services | VPS |
| `cron_manager` | List, add, and remove cron jobs | Both |
| `process_manager` | List and kill running processes | Both |
| `system_info` | CPU, RAM, disk, uptime metrics | Both |
| `memory_read` | Read MEMORY.md, SOUL.md, or daily logs | Both |
| `memory_write` | Append notes to memory files | Both |
| `clear_history` | Clear conversation history | Both |
| `ai_query` | Query an AI model for sub-task instructions | Both |
| `web_search` | Search the web via SerpAPI or DuckDuckGo | Both |
| `code_executor` | Execute code in a sandboxed environment | Both |
| `browser_automation` | Automate browser actions via Puppeteer | VPS |
| `self_update` | Check for updates and pull latest version | Both |
| `self_modify` | Edit own source files, rebuild, and restart | Both |
| `spawn_agent` | Spawn a parallel sub-agent child process | Both |
| `check_agent` | Check the status of a running sub-agent | Both |
| `list_agents` | List all active sub-agents | Both |
| `kill_agent` | Terminate a sub-agent | Both |
| `termux_api` | Termux:API device integration (SMS, camera, etc.) | Android |
| `root_shell` | Execute commands as root via `su -c` | Android |
| `android_info` | Get Android device information | Android |
| `daemon_manager` | Manage SuperClaw as a background daemon | Both |

## Code Style Guidelines

### TypeScript Conventions

- **Strict mode enabled** — all code must pass `tsc --noEmit`
- **Explicit types** on function parameters and returns
- **Interface over type** for object shapes
- **No `any` without justification** — use `unknown` when type is truly unknown

### Naming Conventions

```typescript
// Classes: PascalCase
class AgentOrchestrator { }

// Interfaces: PascalCase with descriptive names
interface SubAgentTask { }

// Type aliases: PascalCase
type TaskStatus = 'pending' | 'running' | 'completed';

// Variables/functions: camelCase
const agentOrchestrator = new AgentOrchestrator();
function spawnAgent() { }

// Constants: UPPER_SNAKE_CASE for true constants
const MAX_ITERATIONS = 10;

// Environment-based config: camelCase in config object
const dbPath = process.env.DB_PATH;
```

### Error Handling

Always use try-catch with proper logging:

```typescript
try {
  const result = await someOperation();
  return { success: true, data: result };
} catch (error: any) {
  logger.error('Operation failed', { error: error.message });
  return { success: false, error: error.message };
}
```

Tools must return `ToolResult` format:

```typescript
interface ToolResult {
  success: boolean;
  data?: any;
  error?: string;
}
```

### Async Patterns

- Prefer `async/await` over raw Promises
- Use `Promise.all()` for parallel independent operations
- Always await or handle Promise rejections

## Key Architectural Patterns

### 1. Gateway Pattern

The `Gateway` class is the central message broker. Platforms register senders; the Brain registers a message handler. All cross-platform communication flows through here.

### 2. Tool Registration

Tools self-register in `ToolRegistry.ts`. Each tool implements the `Tool` interface:

```typescript
interface Tool {
  name: string;
  description: string;
  parameters: Record<string, any>; // JSON Schema
  execute(params: any): Promise<ToolResult>;
}
```

### 3. Sub-Agent System

Sub-agents are forked Node.js processes (`child_process.fork`) that run independent AI loops. They communicate via IPC:

- Master → Child: `init`, `kill` messages
- Child → Master: `ready`, `progress`, `tool_call`, `complete`, `error` messages

Sub-agents use `SubAgentToolRegistry` which excludes sub-agent spawning (no nested agents).

### 4. Confirmation System

Destructive operations (defined in `ShellTool.DESTRUCTIVE_PATTERNS`) trigger a confirmation flow:

1. Tool calls `gateway.requestConfirmation()`
2. Gateway sends confirmation UI (Telegram inline buttons / WhatsApp text reply)
3. User responds → `gateway.handleConfirmation()` resolves the promise
4. Tool proceeds or cancels based on boolean result

### 5. Conversation Management

- Conversation history stored in SQLite (`ConversationDB`)
- Auto-pruned to 50 messages per user (configurable via `maxMessages`)
- Only last 20 messages sent to AI to manage context window
- Manual clear via `/clear` command or `clear_history` tool

## Android/Termux Development

### Running on Android

SuperClaw runs natively in Termux on Android. Use `termux-setup.sh` for automated setup.

```bash
pkg update && pkg upgrade
pkg install git nodejs-lts
git clone https://github.com/yourusername/superclaw
cd superclaw
bash termux-setup.sh
```

### Termux:API Integration

The `termux_api` tool requires the `termux-api` package and the Termux:API companion app from F-Droid:

```bash
pkg install termux-api
```

Available actions: `sms_send`, `sms_list`, `notification`, `camera_photo`, `location`, `battery_status`, `clipboard_get`, `clipboard_set`, `vibrate`, `torch`, `wifi_connectioninfo`, `tts_speak`, and more.

The tool wraps the `termux-*` CLI commands and returns structured JSON output. If Termux:API is not installed, the tool returns a descriptive error rather than crashing.

### Root Shell

The `root_shell` tool executes commands as root using `su -c "command"`. Requires a rooted device. All root executions are logged at `WARN` level for auditability:

```typescript
logger.warn('RootShellTool executing', { command });
```

If the device is not rooted or `su` is unavailable, the tool returns a clear error message.

### Android Device Info

The `android_info` tool returns:
- Device model and manufacturer
- Android version and build number
- Available internal and external storage
- Termux environment details (home directory, prefix path)
- Root availability status

### Daemon Management

The `daemon_manager` tool manages SuperClaw as a background service:

- **Termux:Boot**: Auto-start on Android reboot (requires Termux:Boot from F-Droid). Installs a boot script to `~/.termux/boot/start-superclaw.sh`.
- **systemd**: User service unit for Linux VPS (`~/.config/systemd/user/superclaw.service`)
- **PM2**: Process manager for production VPS deployments

### Android-Specific Environment Variables

No additional env vars required. Android capabilities are auto-detected at startup via `detectAndroidSupport()` in `superclawConfig.ts`. The detection checks for:
- `TERMUX_VERSION` environment variable
- Presence of `termux-api` binary
- `su` binary availability for root detection

## Testing

**Note:** The project currently does not have automated tests. When adding features:

1. **Manual testing via Telegram/WhatsApp:** Send test messages to verify behavior
2. **Tool testing:** Use direct commands like `!shell ls -la` to test specific tools
3. **Sub-agent testing:** Use natural language: "spawn a sub-agent to check disk usage"
4. **Health check:** Run `pnpm doctor` to verify configuration and connectivity

### Testing Checklist for New Features

- [ ] Feature works in Telegram
- [ ] Feature works in WhatsApp (if applicable)
- [ ] Error cases are handled gracefully
- [ ] Logs are informative but don't leak sensitive data
- [ ] Rate limiting works correctly
- [ ] Confirmation flow works for destructive operations
- [ ] `pnpm doctor` passes after changes

## Security Considerations

### Critical Security Rules

1. **Authorization:** All platforms check `userId` against `config.adminTelegramId` / `config.adminWhatsappNumber`
2. **No .env exposure:** Never log or return environment variable values
3. **Destructive operation confirmation:** All `rm -rf`, `mkfs`, `dd`, etc. require explicit user confirmation
4. **Shell command timeout:** Default 30s, max output 10MB
5. **Rate limiting:** Configurable per-minute limits on messages and AI calls
6. **Root audit logging:** All `root_shell` executions logged at `WARN` level

### Safe Code Patterns

```typescript
// GOOD: Check auth before processing
if (userId !== config.adminTelegramId) {
  await ctx.reply('Unauthorized. This is a private agent.');
  return;
}

// GOOD: Sanitize inputs before shell execution
const sanitized = command.replace(/[;&|`$]/g, '');

// GOOD: Never expose env in responses
return { success: true, data: 'Configuration updated' };
// NOT: { success: true, data: process.env.SECRET_KEY }

// GOOD: Log root operations at WARN level
logger.warn('RootShellTool executing', { command });
```

## Adding New Tools

1. Create file in `src/tools/NewTool.ts`:

```typescript
import { Tool, ToolResult } from '../gateway/types';
import { logger } from '../logger';

export class NewTool implements Tool {
  name = 'new_tool_name';
  description = 'What this tool does';
  parameters = {
    type: 'object',
    properties: {
      param1: { type: 'string', description: 'Parameter description' },
    },
    required: ['param1'],
  };

  async execute(params: { param1: string }): Promise<ToolResult> {
    try {
      logger.info(`NewTool executing with param1: ${params.param1}`);
      // Tool logic here
      return { success: true, data: { result: 'success' } };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  }
}

export const newTool = new NewTool();
```

2. Register in `src/brain/ToolRegistry.ts`:

```typescript
import { newTool } from '../tools/NewTool';

// In registerAll():
this.tools.set(newTool.name, newTool);
```

3. If sub-agents should also use this tool, add to `src/agents/SubAgentToolRegistry.ts`

4. Update `src/types/SuperclawConfig.ts` if the tool should be optional

## Deployment Process

### Production Deployment (PM2)

```bash
# Build first
pnpm build

# Start with PM2
pm2 start ecosystem.config.js

# Save PM2 config to restart on boot
pm2 save
pm2 startup
```

### Docker Deployment

```bash
# Build and start
docker-compose up -d

# View logs
docker-compose logs -f superclaw

# Rebuild after code changes
docker-compose build --no-cache && docker-compose up -d

# Run health check
docker-compose --profile doctor run --rm superclaw-doctor
```

### Updating Production

```bash
# Option 1: Use the update script
./update.sh

# Option 2: Manual update
git pull
pnpm install
pnpm rebuild better-sqlite3
pnpm build
pm2 restart superclaw
```

### PM2 Configuration (ecosystem.config.js)

- Max memory restart: 500MB
- Daily restart at 4 AM (cron_restart)
- Logs to `logs/pm2.log` and `logs/pm2-error.log`

## Common Issues and Solutions

### better-sqlite3 Build Failures

```bash
# Rebuild native modules
pnpm rebuild better-sqlite3

# Or full clean install
rm -rf node_modules pnpm-lock.yaml
pnpm install
```

### WhatsApp QR Code Not Showing

- Check logs: `pm2 logs superclaw --lines 50`
- Delete session folder: `rm -rf whatsapp-session-baileys/`
- Restart: `pm2 restart superclaw`

### AI API Errors

Telegram provides inline buttons to update base URL or API key when errors occur. The platform sets user state and waits for the next message. Configure `FALLBACK_AI_PROVIDER` for automatic failover.

### Termux:API Not Working

- Ensure Termux:API app is installed from F-Droid (not Google Play)
- Run `pkg install termux-api` inside Termux
- Grant all permissions to Termux:API in Android settings

### Root Shell Not Working

- Verify device is rooted: `su -c "id"` in Termux
- Ensure your root manager (Magisk, KernelSU) grants Termux root access

## File Locations Reference

| Purpose | Path |
|---------|------|
| Source code | `src/` |
| Compiled output | `dist/` |
| Database | `data/superclaw.db` |
| Memory files | `memory/` (MEMORY.md, SOUL.md) |
| Daily logs | `memory/logs/YYYY-MM-DD.md` |
| Sub-agent tasks | `data/tasks/<uuid>.json` |
| Application logs | `logs/app.log`, `logs/error.log` |
| WhatsApp session (Baileys) | `whatsapp-session-baileys/` |
| WhatsApp session (Puppeteer) | `whatsapp-session/` |
| Environment config | `.env` |
| Runtime config | `superclaw.config.json` |
| PM2 config | `ecosystem.config.js` |
| Docker config | `Dockerfile`, `docker-compose.yml` |
| Docker ignore | `.dockerignore` |

## Version History

See `README.md` for detailed changelog. Current version is in `package.json`.

---

**Last updated:** 2026-02-28
**Agent guide version:** 1.1.0
