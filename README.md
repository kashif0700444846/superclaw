# 🦀 SuperClaw

> Lightweight, self-hosted autonomous AI agent for VPS and Android (Termux)

[![Node.js](https://img.shields.io/badge/Node.js-20+-green)](https://nodejs.org)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.3+-blue)](https://typescriptlang.org)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow)](LICENSE)

---

## Features

- **Telegram + WhatsApp** messaging (Baileys WebSocket or Puppeteer)
- **26 built-in tools** — shell, file I/O, HTTP, package manager, service manager, cron, process manager, system info, memory, web search, code executor, browser automation, self-modify, self-update, sub-agents, Termux API, root shell, Android info, daemon manager
- **Android/Termux support** — run SuperClaw on a rooted or non-rooted Android device
- **Termux:API integration** — SMS, notifications, camera, location, battery, clipboard, TTS, torch, Wi-Fi info, and more
- **Root shell execution** — run privileged commands via `su -c` on rooted devices
- **Daemon management** — Termux:Boot auto-start, systemd user services, PM2 process manager
- **AI model failover** — automatic retry with exponential backoff; optional fallback provider
- **Typing indicators** on Telegram while the agent is thinking
- **Sub-agent parallel task execution** — spawn independent AI child processes for concurrent work
- **Self-modification** — the agent can edit its own TypeScript source, rebuild, and restart
- **Hallucination detection** — adds disclaimer when describing actions without executing them
- **Docker / docker-compose** deployment with persistent volumes
- **Health check CLI** — `pnpm doctor` for instant system diagnostics

---

## Quick Start

Choose your deployment target:

| Path | Guide |
|------|-------|
| 🖥️ VPS (Linux) | [VPS Installation](#vps-installation) |
| 📱 Android (Termux) | [Android/Termux Installation](#androidtermux-installation) |
| 🐳 Docker | [Docker Installation](#docker-installation) |

---

## VPS Installation

```bash
# 1. Clone the repository
git clone https://github.com/yourusername/superclaw
cd superclaw

# 2. Install dependencies
pnpm install

# 3. Run the interactive setup wizard
pnpm setup

# 4. Build TypeScript
pnpm build

# 5. Start with PM2
pm2 start ecosystem.config.js
pm2 save
pm2 startup
```

The setup wizard will ask which AI provider, platforms, and tools you want to enable, then generate `superclaw.config.json` and `.env` for you.

**One-liner install (automated):**

```bash
bash <(curl -fsSL https://raw.githubusercontent.com/yourusername/superclaw/main/install.sh)
```

---

## Android/Termux Installation

> Requires [Termux](https://f-droid.org/packages/com.termux/) from F-Droid (not Google Play).

```bash
# 1. Update packages
pkg update && pkg upgrade

# 2. Install Node.js and git
pkg install git nodejs-lts

# 3. Clone the repository
git clone https://github.com/yourusername/superclaw
cd superclaw

# 4. Run the automated Termux setup script
bash termux-setup.sh
```

**Optional add-ons (from F-Droid):**

- **[Termux:API](https://f-droid.org/packages/com.termux.api/)** — required for SMS, camera, location, notifications, and other device APIs. After installing, run `pkg install termux-api` inside Termux.
- **[Termux:Boot](https://f-droid.org/packages/com.termux.boot/)** — required for auto-start on device reboot. The `daemon_manager` tool can configure this automatically.

---

## Docker Installation

```bash
# 1. Copy and edit environment config
cp .env.example .env
# Edit .env with your API keys and credentials

# 2. Create runtime config (run wizard or copy example)
cp superclaw.config.json.example superclaw.config.json
# Or run: pnpm setup (requires Node.js locally)

# 3. Start the container
docker-compose up -d

# 4. View logs
docker-compose logs -f superclaw
```

**Run the health check doctor:**

```bash
docker-compose --profile doctor run --rm superclaw-doctor
```

**Rebuild after code changes:**

```bash
docker-compose build --no-cache
docker-compose up -d
```

---

## Configuration

### Environment Variables (`.env`)

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `AI_PROVIDER` | ✅ | — | `openai` \| `anthropic` \| `groq` \| `ollama` \| `custom` |
| `AI_MODEL` | ✅ | — | Model name, e.g. `gpt-4o`, `claude-3-5-sonnet-20241022` |
| `OPENAI_API_KEY` | ⚠️ | — | Required if `AI_PROVIDER=openai` |
| `ANTHROPIC_API_KEY` | ⚠️ | — | Required if `AI_PROVIDER=anthropic` |
| `GROQ_API_KEY` | ⚠️ | — | Required if `AI_PROVIDER=groq` |
| `OLLAMA_BASE_URL` | ⚠️ | `http://localhost:11434` | Required if `AI_PROVIDER=ollama` |
| `CUSTOM_AI_BASE_URL` | ⚠️ | — | Required if `AI_PROVIDER=custom` |
| `CUSTOM_AI_MODEL` | ⚠️ | — | Required if `AI_PROVIDER=custom` |
| `CUSTOM_AI_API_KEY` | ⚠️ | — | Required if `AI_PROVIDER=custom` |
| `FALLBACK_AI_PROVIDER` | ❌ | — | Fallback provider if primary fails |
| `FALLBACK_AI_MODEL` | ❌ | — | Fallback model name |
| `AI_MAX_RETRIES` | ❌ | `3` | Max retry attempts on AI API errors |
| `AI_RETRY_DELAY_MS` | ❌ | `1000` | Base delay (ms) for exponential backoff |
| `TELEGRAM_BOT_TOKEN` | ⚠️ | — | Required if Telegram platform enabled |
| `ADMIN_TELEGRAM_ID` | ⚠️ | — | Your Telegram user ID (numeric) |
| `WHATSAPP_SESSION_NAME` | ❌ | `superclaw` | WhatsApp session folder name |
| `ADMIN_WHATSAPP_NUMBER` | ⚠️ | — | Your WhatsApp number, e.g. `15551234567@c.us` |
| `AGENT_NAME` | ❌ | `SuperClaw` | Display name for the agent |
| `VPS_HOSTNAME` | ❌ | — | Hostname shown in system info |
| `LOG_LEVEL` | ❌ | `info` | `debug` \| `info` \| `warn` \| `error` |
| `DB_PATH` | ❌ | `./data/superclaw.db` | SQLite database path |
| `SERPAPI_KEY` | ❌ | — | SerpAPI key for web search (optional) |
| `MAX_MESSAGES_PER_MINUTE` | ❌ | `30` | Rate limit for incoming messages |
| `MAX_AI_CALLS_PER_MINUTE` | ❌ | `10` | Rate limit for AI API calls |
| `MAX_CONCURRENT_TOOLS` | ❌ | `5` | Max parallel tool executions |
| `MAX_CONCURRENT_AGENTS` | ❌ | `5` | Max parallel sub-agents |
| `SUBAGENT_TIMEOUT_MS` | ❌ | `600000` | Sub-agent timeout (10 min default) |

### Runtime Configuration (`superclaw.config.json`)

Generated by `pnpm setup`. Controls which platforms and tools are active at runtime:

```json
{
  "schemaVersion": 1,
  "platforms": ["telegram"],
  "whatsappDriver": "baileys",
  "enabledTools": ["shell_execute", "file_read", "file_write", "file_list"],
  "disabledTools": [],
  "estimatedRamMb": 80,
  "generatedAt": "2026-02-28T00:00:00.000Z"
}
```

---

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

---

## Android Features

SuperClaw runs natively in Termux on Android, with dedicated tools for device control.

### Termux:API Commands

The `termux_api` tool wraps the `termux-*` CLI commands. Requires `pkg install termux-api` and the Termux:API companion app from F-Droid.

| Action | Description |
|--------|-------------|
| `sms_send` | Send an SMS message |
| `sms_list` | List received SMS messages |
| `notification` | Show a system notification |
| `camera_photo` | Take a photo with the device camera |
| `location` | Get current GPS location |
| `battery_status` | Get battery level and charging state |
| `clipboard_get` | Read clipboard contents |
| `clipboard_set` | Write to clipboard |
| `vibrate` | Vibrate the device |
| `torch` | Toggle the flashlight |
| `wifi_connectioninfo` | Get current Wi-Fi connection details |
| `tts_speak` | Text-to-speech output |

### Root Shell

The `root_shell` tool executes commands as root using `su -c "command"`. Requires a rooted device. All root executions are logged at `WARN` level for auditability.

```
You: run "id" as root
SuperClaw: uid=0(root) gid=0(root) groups=0(root)
```

### Android Device Info

The `android_info` tool returns device model, Android version, build number, available storage, and Termux environment details.

### Daemon Management

The `daemon_manager` tool manages SuperClaw as a persistent background service:

| Mode | Description |
|------|-------------|
| **Termux:Boot** | Auto-start on Android reboot (requires Termux:Boot from F-Droid) |
| **systemd** | User service unit for Linux VPS |
| **PM2** | Process manager for production VPS deployments |

Android capabilities are auto-detected at startup via `detectAndroidSupport()` in `superclawConfig.ts`. No additional environment variables are required.

---

## Self-Modification

SuperClaw can modify its own source code, rebuild, and restart itself — all from a chat message.

```
You: add a tool that tells me the current weather
SuperClaw: I'll create WeatherTool.ts, register it, rebuild, and restart...
```

The `self_modify` tool supports these actions:

| Action | Description |
|--------|-------------|
| `list_files` | List all source files in `src/` |
| `read_file` | Read a source file |
| `write_file` | Write or overwrite a source file |
| `rebuild` | Run `pnpm build` |
| `restart` | Restart the process via PM2 |
| `rebuild_and_restart` | Build then restart atomically |

**Safety constraints:** Only files under `src/` can be modified. The build must succeed before a restart is triggered.

---

## Sub-Agents

SuperClaw can spawn parallel child processes to handle long-running or concurrent tasks independently.

```
You: spawn an agent to monitor disk usage every minute for 10 minutes and report back
SuperClaw: Spawned agent abc-123. I'll notify you when it's done.
[10 minutes later]
SuperClaw: Agent abc-123 completed. Disk usage stayed below 60% throughout.
```

**How it works:**

1. `spawn_agent` forks a new Node.js child process running `SubAgent.ts`
2. The sub-agent runs its own AI loop with a subset of tools (no nested spawning)
3. Progress updates are sent to you in real-time via Telegram/WhatsApp
4. Results are persisted in `data/tasks/<uuid>.json`
5. Up to 5 concurrent sub-agents; 10-minute timeout by default

---

## Health Check

Run the built-in doctor to verify your configuration and connectivity:

```bash
pnpm doctor
```

The doctor checks:
- Node.js version compatibility
- Required environment variables
- AI provider connectivity
- Telegram/WhatsApp credentials
- Database accessibility
- Memory file existence
- Tool availability

---

## Commands Reference

| Command | Description |
|---------|-------------|
| `pnpm install` | Install all dependencies |
| `pnpm dev` | Start in development mode (hot reload via tsx) |
| `pnpm build` | Compile TypeScript to `dist/` |
| `pnpm start` | Run compiled production build |
| `pnpm setup` | Launch interactive setup wizard |
| `pnpm doctor` | Run health check diagnostics |
| `pnpm lint` | Type-check without emitting output |

---

## Architecture

SuperClaw is built around a modular, event-driven architecture:

```
Telegram / WhatsApp
        │
        ▼
    Gateway.ts          ← Central message broker
        │
        ▼
     Brain.ts           ← AI orchestrator (tool-call loop)
     ├── FunctionCaller.ts   ← AI provider abstraction
     ├── PromptBuilder.ts    ← System prompt construction
     └── ToolRegistry.ts     ← Tool registration
        │
        ▼
    Tools (26x)         ← Modular tool implementations
        │
        ▼
  AgentOrchestrator     ← Sub-agent process manager
  ConversationDB        ← SQLite history
  MemoryManager         ← Markdown-based long-term memory
```

**Key patterns:**

- **Gateway pattern** — all platform messages route through a single broker
- **Tool interface** — every tool implements `{ name, description, parameters, execute() }`
- **Confirmation system** — destructive shell operations require explicit user approval
- **Forked sub-agents** — child processes communicate via Node.js IPC

---

## Memory & RAM Usage

| Configuration | Approx. RAM |
|---------------|-------------|
| Telegram only | ~80 MB |
| WhatsApp (Baileys) only | ~100 MB |
| Both platforms | ~120 MB |
| With Puppeteer WhatsApp | ~500 MB |
| Docker container | ~130 MB (Telegram + Baileys) |

---

## Supported AI Providers

| Provider | Notes |
|----------|-------|
| **OpenAI** | GPT-4o, GPT-4-turbo, GPT-3.5-turbo |
| **Anthropic** | Claude 3.5 Sonnet, Haiku, Opus |
| **Groq** | Very fast inference, free tier available |
| **Ollama** | Run open-source models locally |
| **Custom** | Any OpenAI-compatible API (OpenRouter, LM Studio, etc.) |

Configure a fallback provider with `FALLBACK_AI_PROVIDER` and `FALLBACK_AI_MODEL` for automatic failover with exponential backoff.

---

## Security

- **Authorization** — all platforms verify `userId` against `ADMIN_TELEGRAM_ID` / `ADMIN_WHATSAPP_NUMBER` before processing any message
- **Destructive operation confirmation** — `rm -rf`, `mkfs`, `dd`, and similar commands require explicit user confirmation via Telegram inline buttons or WhatsApp reply
- **No `.env` exposure** — environment variables are never logged or returned in tool responses
- **Shell timeout** — commands time out after 30 seconds; output capped at 10 MB
- **Rate limiting** — configurable per-minute limits on messages and AI API calls
- **Root audit logging** — all `root_shell` executions are logged at `WARN` level

---

## Updating

```bash
# Using the update script (recommended)
./update.sh

# Manual update
git pull
pnpm install
pnpm rebuild better-sqlite3
pnpm build
pm2 restart superclaw
```

Or ask SuperClaw directly: *"check for updates"* or *"update yourself"*.

---

## Changelog

### v2.9.0
- **Fix hallucination**: AI now adds disclaimer when it describes actions without executing them; max 10 tool-call iterations
- **Fix slow responses**: Conversation history capped at 20 messages; system prompt trimmed
- **Fix sub-agents**: AgentOrchestrator now forks compiled JS (`dist/`) instead of TypeScript source; better error handling
- **Pruning**: Old conversation messages auto-pruned to keep context lean

### v2.8.0
- **Self-modification**: SuperClaw can now edit its own TypeScript source files, rebuild, and restart itself
- New `self_modify` tool with actions: `list_files`, `read_file`, `write_file`, `rebuild`, `restart`, `rebuild_and_restart`
- Safety checks: only `src/*.ts` files can be modified; rebuild must succeed before restart

### v2.7.0
- `self_update` tool: shows current vs latest version on check
- `self_update` tool: new `changelog` action — ask "what changed recently" to see last 5 commits
- Improved user-friendly response messages

### v2.6.0
- Fixed `update.sh`: git checkout `pnpm-lock.yaml` before pull to prevent merge conflicts
- Added `self_update` tool: SuperClaw can check for updates and update itself

### v2.5.0
- Added real sub-agent system: spawn parallel child processes with different AI models
- New tools: `spawn_agent`, `check_agent`, `list_agents`, `kill_agent`
- Sub-agents run as real Node.js child processes via `fork()`
- Max 5 concurrent sub-agents, 10-minute timeout, automatic cleanup
- Progress notifications sent to user in real-time

### v2.4.0
- Fixed wizard writing trailing quotes into `.env` values (caused invalid Telegram token)
- All env values are now sanitized before being written to `.env`

### v2.3.0
- Fixed `better-sqlite3` native binary compilation on Linux
- Added `pnpm.onlyBuiltDependencies` config to `package.json` for automatic native builds
- `update.sh` now rebuilds native modules after `pnpm install`

### v2.2.0
- Fixed custom API provider connection test
- Wizard now fetches available models from `/v1/models` and shows a selectable list
- Added `update.sh`

### v2.1.0
- Added Custom OpenAI-compatible API provider support (OpenRouter, LM Studio, etc.)
- Custom provider connection test during setup wizard
- Fixed esbuild Linux binary issue
- Added `.npmrc` to skip Chromium download automatically

### v2.0.0
- Complete rewrite with modular architecture
- Replaced `whatsapp-web.js` (Puppeteer) with Baileys (WebSocket, no Chromium)
- Interactive setup wizard with live RAM estimates
- `superclaw.config.json` for runtime platform/tool selection

### v1.0.0
- Initial release

---

## License

[MIT](LICENSE) — do whatever you want with it.
