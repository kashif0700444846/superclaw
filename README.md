# SuperClaw

**A lightweight, self-hosted AI agent that lives on your VPS and does things for you.**

[![Version](https://img.shields.io/badge/version-2.1.0-blue.svg)](https://github.com/kashif0700444846/superclaw/releases)
[![License](https://img.shields.io/badge/license-MIT-green.svg)](LICENSE)
[![Node.js](https://img.shields.io/badge/node-%3E%3D20-brightgreen.svg)](https://nodejs.org)

---

## What is SuperClaw?

SuperClaw is a personal AI agent you deploy on your own server. Once it's running, you can talk to it through Telegram or WhatsApp and ask it to do real things — run shell commands, manage files, search the web, install packages, execute code, and more. It's not a chatbot that just answers questions; it actually *does stuff*.

Under the hood, SuperClaw connects to whichever AI provider you prefer — OpenAI, Anthropic, Groq, Ollama, or any OpenAI-compatible API like OpenRouter or LM Studio. You're not locked into anything. Swap providers anytime by editing a config file.

The whole thing is modular. During setup, a wizard walks you through which platforms and tools you want to enable. Don't need WhatsApp? Skip it. Don't want web search? Leave it out. You end up with exactly what you need and nothing you don't.

---

## Why SuperClaw?

Most self-hosted AI agent projects are either too heavy (Chromium-based, 500+ MB RAM, need a real database) or too bare-bones to actually be useful. SuperClaw sits in the middle.

- **No Chromium required** — WhatsApp support uses [Baileys](https://github.com/WhiskeySockets/Baileys), a WebSocket-based library. No headless browser, no bloat.
- **Runs on a $5 VPS** — typical RAM usage is 80–120 MB depending on your config.
- **SQLite for storage** — conversation history and memory are stored locally. No separate database server to manage.
- **Simple to update** — one command and you're on the latest version.

---

## Quick Install

The fastest way to get started is the one-liner:

```bash
bash <(curl -fsSL https://raw.githubusercontent.com/kashif0700444846/superclaw/main/install.sh)
```

This script will:
1. Check for Node.js (>=20) and install it if it's missing
2. Clone the SuperClaw repo to `/www/wwwroot/superclaw`
3. Run `pnpm install` to pull in dependencies
4. Launch the interactive setup wizard

The wizard asks you a few questions — which AI provider to use, which platforms to enable, your API keys — and generates a `superclaw.config.json` for you. Then it starts the agent with PM2.

### Prefer to do it manually?

```bash
git clone https://github.com/kashif0700444846/superclaw.git
cd superclaw
pnpm install
npx tsx src/setup/wizard.ts
```

Same result, just more hands-on.

---

## Updating SuperClaw

```bash
cd /www/wwwroot/superclaw && git pull && pnpm install && pm2 restart superclaw
```

That's it. Every release bumps the version number, so you can always check `package.json` or the changelog below to see what changed.

---

## Supported AI Providers

| Provider | Notes |
|---|---|
| OpenAI | GPT-4o, GPT-4-turbo, and other OpenAI models |
| Anthropic | Claude 3.5 Sonnet, Haiku, and the rest of the Claude family |
| Groq | Very fast inference, has a free tier |
| Ollama | Run open-source models locally on your VPS |
| Custom | Any OpenAI-compatible API — OpenRouter, LM Studio, etc. |

---

## What Can It Do?

SuperClaw ships with 15 built-in tools, organized into a few categories:

**Shell & System**
Run arbitrary shell commands, manage background processes, set up cron jobs, start/stop system services, and pull system info (CPU, memory, disk, etc.).

**Files**
Read files, write files, list directory contents. Useful for having the agent inspect logs, edit config files, or generate output directly on the server.

**Web**
Make HTTP requests to external APIs and search the web. Good for fetching data, checking URLs, or pulling in information from the internet.

**AI**
Query any configured AI provider from within a task. The agent can delegate sub-tasks to a different model if needed, and it can execute code in a sandboxed environment.

**Memory**
Read and write to long-term memory. SuperClaw can remember things across conversations — preferences, notes, context — and refer back to them later.

**Package Management**
Install and manage packages via `apt`, `npm`, or `pip` directly from a chat message.

---

## Memory & RAM Usage

| Config | Approx. RAM |
|---|---|
| Telegram only | ~80 MB |
| WhatsApp (Baileys) only | ~100 MB |
| Both platforms | ~120 MB |
| With Puppeteer WhatsApp | ~500 MB |

The Puppeteer-based WhatsApp option is still available if you need it, but Baileys is the default and recommended choice for low-resource setups.

---

## Changelog

### v2.6.0 (2026-02-28)
- Fixed update.sh: git checkout pnpm-lock.yaml before pull to prevent merge conflicts
- Added self_update tool: SuperClaw can check for updates and update itself via Telegram/WhatsApp
- Say "check for updates" or "update yourself" to trigger self-update

### v2.5.0 (2026-02-28)
- Added real sub-agent system: SuperClaw can now spawn parallel child processes with different AI models
- New tools: spawn_agent, check_agent, list_agents, kill_agent
- Sub-agents run as real Node.js child processes via fork()
- Max 5 concurrent sub-agents, 10-minute timeout, automatic cleanup
- Progress notifications sent to user in real-time via Telegram/WhatsApp

### v2.4.0 (2026-02-28)
- Fixed wizard writing trailing quotes into .env values (caused invalid Telegram token)
- All env values are now sanitized before being written to .env

### v2.3.0 (2026-02-28)
- Fixed better-sqlite3 native binary compilation on Linux (no more manual pnpm approve-builds)
- Added pnpm.onlyBuiltDependencies config to package.json for automatic native builds
- update.sh now rebuilds native modules after pnpm install

### v2.2.0 (2026-02-28)
- Fixed custom API provider connection test (removed max_tokens limit for better compatibility)
- Wizard now fetches available models from /v1/models and shows a selectable list
- Added update.sh — single command to update SuperClaw on your VPS

### v2.1.0 (2026-02-27)
- Added Custom OpenAI-compatible API provider support (OpenRouter, LM Studio, etc.)
- Custom provider connection test during setup wizard
- Fixed esbuild Linux binary issue (no more `--no-optional` needed)
- Added `.npmrc` to skip Chromium download automatically
- Version bumping on every release going forward

### v2.0.0
- Complete rewrite with modular architecture
- Replaced whatsapp-web.js (Puppeteer) with Baileys (WebSocket, no Chromium)
- Interactive setup wizard with live RAM estimates
- `superclaw.config.json` for runtime platform/tool selection
- Three install modes: Ultra-Lite, Standard, Full

### v1.0.0
- Initial release

---

## License

[MIT](LICENSE) — do whatever you want with it.
