# 🦞 SuperClaw — Lightweight Autonomous AI Agent

SuperClaw is a **modular, memory-efficient** autonomous AI agent that runs on a Linux Ubuntu VPS and is controlled via Telegram and/or WhatsApp. It delivers the same capabilities as OpenClaw-style agents at a **fraction of the memory footprint**.

## Why SuperClaw?

| | SuperClaw Ultra-Lite | SuperClaw Standard | SuperClaw Full | OpenClaw (typical) |
|--|--|--|--|--|
| **RAM** | ~110 MB | ~150 MB | ~600 MB | ~600–1000 MB |
| **Storage** | ~500 MB | ~600 MB | ~1.5 GB | ~1.5–2 GB |
| **Platforms** | Telegram | Telegram + WhatsApp | Telegram + WhatsApp | Telegram + WhatsApp |
| **WhatsApp Driver** | — | Baileys (WebSocket) | Puppeteer (Chromium) | Puppeteer (Chromium) |
| **Chromium required** | ❌ No | ❌ No | ✅ Yes | ✅ Yes |
| **Min VPS** | $4/mo (1 GB) | $4/mo (1 GB) | $6/mo (2 GB) | $6–12/mo (2–4 GB) |

**SuperClaw Standard uses ~75% less RAM than a typical OpenClaw setup.**

## Features

- 🤖 **AI-Powered**: OpenAI GPT-4o, Anthropic Claude, Groq (free tier), or local Ollama
- 📱 **Dual Platform**: Telegram and/or WhatsApp (your choice)
- ⚡ **Lightweight WhatsApp**: Baileys driver uses WebSocket directly — no Chromium browser
- 🔧 **15 Built-in Tools**: Shell, file management, HTTP, packages, systemd, cron, processes, and more
- 🧠 **Persistent Memory**: Long-term memory via Markdown files, conversation history via SQLite
- 🔒 **Secure**: Admin-only access, destructive command confirmation, rate limiting
- 🚀 **Always-On**: PM2 process manager with auto-restart
- 🧩 **Modular**: Only load what you need — disable unused platforms and tools

## Quick Start

### Prerequisites
- Ubuntu 22.04 LTS VPS
- A Telegram bot token (from [@BotFather](https://t.me/BotFather))
- Your Telegram user ID (from [@userinfobot](https://t.me/userinfobot))
- An AI API key (OpenAI, Anthropic, Groq) or local Ollama

### One-Command Install

```bash
git clone https://github.com/yourusername/superclaw.git ~/superclaw
cd ~/superclaw
bash install.sh
```

The installer will ask you to choose a mode:

```
Available modes:

  1) Ultra-Lite  — Telegram only
     RAM: ~110 MB | Storage: ~500 MB | No Chromium

  2) Standard    — Telegram + WhatsApp (Baileys, no Chromium)
     RAM: ~150 MB | Storage: ~600 MB | Recommended

  3) Full        — Telegram + WhatsApp (Puppeteer/Chromium)
     RAM: ~600 MB | Storage: ~1.5 GB | Maximum compatibility

  Comparison: OpenClaw typically uses ~600 MB+ RAM
```

### Manual Setup

```bash
# Install dependencies (lite — no Chromium)
pnpm install --no-optional

# Or full install (includes Puppeteer/Chromium)
pnpm install

# Run setup wizard (choose platforms, see RAM estimates)
npx tsx src/setup/wizard.ts

# Build and start
pnpm build
pm2 start ecosystem.config.js
```

## Setup Wizard

The interactive wizard guides you through configuration and shows real-time memory estimates:

```
📱 STEP 1: Choose Platforms

  Telegram only:              ~110 MB
  WhatsApp only (Baileys):    ~120 MB
  Both (Baileys):             ~150 MB  ← Recommended
  Both (Puppeteer):           ~560 MB

⚙️  STEP 2: WhatsApp Driver

  Baileys   ✓ Recommended — ~40 MB, no Chromium
  Puppeteer ⚠ Heavy — ~450 MB, requires Chromium

📊 STEP 7: Configuration Summary

  Platforms:    telegram, whatsapp
  WA Driver:    Baileys (lightweight)
  AI Provider:  openai / gpt-4o
  Tools:        13 enabled

  Memory Footprint:
  [████████░░░░░░░░░░░░] ~150 MB RAM

  ✓ 450 MB lighter than a typical OpenClaw setup (~600 MB)
  ✓ 75% less RAM usage
```

## Configuration

All settings are stored in two files:
- `.env` — API keys and credentials
- `superclaw.config.json` — platform/tool selection (written by wizard)

### `superclaw.config.json` example

```json
{
  "schemaVersion": 1,
  "platforms": ["telegram", "whatsapp"],
  "whatsappDriver": "baileys",
  "enabledTools": ["shell_execute", "file_read", "file_write", "file_list",
    "http_request", "package_manager", "service_manager", "cron_manager",
    "process_manager", "system_info", "memory_read", "memory_write", "ai_query"],
  "disabledTools": ["web_search", "code_executor"],
  "estimatedRamMb": 150,
  "generatedAt": "2026-01-01T00:00:00.000Z"
}
```

### Key `.env` Variables

| Variable | Description |
|----------|-------------|
| `AI_PROVIDER` | `openai` \| `anthropic` \| `groq` \| `ollama` |
| `AI_MODEL` | e.g. `gpt-4o`, `claude-3-5-sonnet-20241022`, `llama-3.3-70b-versatile` |
| `TELEGRAM_BOT_TOKEN` | From @BotFather |
| `ADMIN_TELEGRAM_ID` | Your Telegram user ID |
| `ADMIN_WHATSAPP_NUMBER` | Baileys: `15551234567@s.whatsapp.net` / Puppeteer: `15551234567@c.us` |
| `AGENT_NAME` | Display name (default: SuperClaw) |

## Usage

### Telegram Commands

| Command | Description |
|---------|-------------|
| `/start` | Agent status |
| `/help` | List all commands |
| `/memory` | Show long-term memory |
| `/logs` | Today's activity log |
| `/status` | VPS system info |

### Direct Commands (both platforms)

| Command | Description |
|---------|-------------|
| `!shell <cmd>` | Execute shell command |
| `!remember <fact>` | Save to long-term memory |
| `!ask <question>` | Ask AI directly |
| `!read <path>` | Read a file |
| `!status` | System information |

### Natural Language

```
"install nginx and configure it for example.com"
"show disk usage"
"restart the postgresql service"
"set up a cron job to backup /var/www every night at 2am"
"what processes are using the most CPU?"
```

## Architecture

```
┌─────────────────────────────────────────────────────┐
│                    GATEWAY LAYER                     │
│  Normalizes messages • Routes to Brain               │
│  Rate limiting • Confirmation handling               │
├──────────────────┬──────────────────────────────────┤
│  TELEGRAM        │  WHATSAPP                        │
│  (grammy)        │  Baileys ← lightweight           │
│  ~30 MB          │  ~40 MB  (no Chromium)           │
│                  │  — or —                          │
│                  │  Puppeteer (Chromium) ~450 MB    │
└──────────────────┴──────────────────────────────────┘
                         │
┌────────────────────────▼────────────────────────────┐
│                    BRAIN LAYER                       │
│  PromptBuilder → FunctionCaller → Tool Loop          │
│  OpenAI / Anthropic / Groq / Ollama                  │
└────────────────────────┬────────────────────────────┘
                         │
┌────────────────────────▼────────────────────────────┐
│              TOOL LAYER (up to 15 tools)             │
│  Core: shell • file • http • packages • services     │
│  Core: cron • processes • system • memory • ai_query │
│  Optional: web_search • code_executor                │
└────────────────────────┬────────────────────────────┘
                         │
┌────────────────────────▼────────────────────────────┐
│                   MEMORY LAYER                       │
│  SOUL.md • MEMORY.md • Daily logs • SQLite           │
└─────────────────────────────────────────────────────┘
```

## File Structure

```
superclaw/
├── src/
│   ├── index.ts                    # Entry point (conditional platform loading)
│   ├── config.ts                   # Environment config
│   ├── logger.ts                   # Winston logger
│   ├── superclawConfig.ts          # superclaw.config.json loader
│   ├── types/
│   │   └── SuperclawConfig.ts      # Config TypeScript interface
│   ├── gateway/
│   │   ├── Gateway.ts              # Message router
│   │   └── types.ts                # Shared types
│   ├── brain/
│   │   ├── Brain.ts                # Decision engine
│   │   ├── PromptBuilder.ts        # Dynamic system prompt
│   │   ├── ToolRegistry.ts         # Conditional tool loading
│   │   └── FunctionCaller.ts       # AI function-calling loop
│   ├── memory/
│   │   ├── MemoryManager.ts        # File-based memory
│   │   └── ConversationDB.ts       # SQLite history
│   ├── platforms/
│   │   ├── TelegramPlatform.ts     # Telegram (grammy)
│   │   ├── WhatsAppBaileysPlatform.ts  # WhatsApp lightweight ⚡
│   │   └── WhatsAppPlatform.ts     # WhatsApp Puppeteer (legacy)
│   ├── tools/                      # 15 tool modules
│   └── setup/
│       └── wizard.ts               # Interactive setup CLI
├── memory/
│   ├── SOUL.md                     # Agent identity
│   ├── MEMORY.md                   # Long-term memory
│   └── logs/                       # Daily logs
├── superclaw.config.json           # Platform/tool config (written by wizard)
├── .env                            # Credentials (gitignored)
├── ecosystem.config.js             # PM2 config
└── install.sh                      # Ubuntu install script
```

## Security

- **Admin-only**: Only your configured Telegram ID and WhatsApp number can send commands
- **Destructive protection**: `rm -rf`, `shutdown`, `DROP TABLE` etc. require Yes/No confirmation
- **Rate limiting**: 30 messages/min, 10 AI calls/min
- **Protected paths**: `.env` and source code are never readable by the agent

## PM2 Management

```bash
pm2 status              # Check status
pm2 logs superclaw      # Live logs
pm2 restart superclaw   # Restart
pm2 stop superclaw      # Stop
```

## Troubleshooting

### WhatsApp QR Code (first run)
```bash
pm2 logs superclaw --lines 100
```
Scan with WhatsApp → Linked Devices → Link a Device.

### WhatsApp Session Expired
```bash
# Baileys
rm -rf whatsapp-session-baileys/
# Puppeteer
rm -rf whatsapp-session/
pm2 restart superclaw
```

### Reconfigure platforms/tools
```bash
rm .env superclaw.config.json
npx tsx src/setup/wizard.ts
pnpm build && pm2 restart superclaw
```

### Switch from Puppeteer to Baileys (save ~400 MB RAM)
```bash
rm superclaw.config.json
npx tsx src/setup/wizard.ts   # choose Baileys this time
pnpm build && pm2 restart superclaw
```

## Updating

```bash
cd ~/superclaw
git pull
pnpm install --no-optional   # or pnpm install for full
pnpm build
pm2 restart superclaw
```

## License

MIT
