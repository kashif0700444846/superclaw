#!/usr/bin/env bash
# ============================================================
# SuperClaw — Modular Ubuntu 22.04 LTS Install Script v2
# Run as a non-root user with sudo access
# Usage: bash install.sh
# ============================================================

set -e

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
BOLD='\033[1m'
NC='\033[0m'

log()    { echo -e "${GREEN}[SuperClaw]${NC} $1"; }
warn()   { echo -e "${YELLOW}[WARN]${NC} $1"; }
error()  { echo -e "${RED}[ERROR]${NC} $1"; exit 1; }
header() { echo -e "\n${CYAN}══════════════════════════════════════════${NC}"; echo -e "${CYAN}  $1${NC}"; echo -e "${CYAN}══════════════════════════════════════════${NC}\n"; }

# ── Banner ────────────────────────────────────────────────
echo -e "${CYAN}"
echo "  ╔══════════════════════════════════════════╗"
echo "  ║     SuperClaw Install Script v2          ║"
echo "  ║   Modular • Lightweight • Autonomous     ║"
echo "  ╚══════════════════════════════════════════╝"
echo -e "${NC}"

# ── Check not root ────────────────────────────────────────
if [ "$EUID" -eq 0 ]; then
  error "Do not run as root. Run as a regular user with sudo access."
fi

# ── Choose Install Mode ───────────────────────────────────
header "Choose Install Mode"

echo -e "${BOLD}Available modes:${NC}\n"
echo -e "  ${GREEN}1) Ultra-Lite${NC}  — Telegram only"
echo -e "     RAM: ~110 MB | Storage: ~500 MB | No Chromium"
echo ""
echo -e "  ${GREEN}2) Standard${NC}    — Telegram + WhatsApp (Baileys, no Chromium)"
echo -e "     RAM: ~150 MB | Storage: ~600 MB | Recommended"
echo ""
echo -e "  ${YELLOW}3) Full${NC}        — Telegram + WhatsApp (Puppeteer/Chromium)"
echo -e "     RAM: ~600 MB | Storage: ~1.5 GB | Maximum compatibility"
echo ""
echo -e "  ${CYAN}Comparison: OpenClaw typically uses ~600 MB+ RAM${NC}"
echo ""

read -p "Select mode [1/2/3] (default: 2): " MODE_CHOICE
MODE_CHOICE=${MODE_CHOICE:-2}

case "$MODE_CHOICE" in
  1)
    INSTALL_MODE="ultra-lite"
    INSTALL_FLAGS="--no-optional"
    INSTALL_CHROMIUM=false
    log "Selected: Ultra-Lite (Telegram only, ~110 MB RAM)"
    ;;
  2)
    INSTALL_MODE="standard"
    INSTALL_FLAGS="--no-optional"
    INSTALL_CHROMIUM=false
    log "Selected: Standard (Telegram + WhatsApp Baileys, ~150 MB RAM)"
    ;;
  3)
    INSTALL_MODE="full"
    INSTALL_FLAGS=""
    INSTALL_CHROMIUM=true
    log "Selected: Full (Telegram + WhatsApp Puppeteer, ~600 MB RAM)"
    ;;
  *)
    warn "Invalid choice. Defaulting to Standard mode."
    INSTALL_MODE="standard"
    INSTALL_FLAGS="--no-optional"
    INSTALL_CHROMIUM=false
    ;;
esac

# ── Check OS ──────────────────────────────────────────────
header "Checking System"

if [ -f /etc/os-release ]; then
  . /etc/os-release
  if [[ "$ID" != "ubuntu" ]]; then
    warn "Designed for Ubuntu. Detected: $ID. Proceeding anyway..."
  else
    log "Ubuntu $VERSION detected"
  fi
fi

# ── Update system ─────────────────────────────────────────
header "Updating System Packages"
sudo apt-get update -y
sudo apt-get install -y curl wget git build-essential python3 python3-pip unzip

# ── Install Node.js 20 LTS ────────────────────────────────
header "Installing Node.js 20 LTS"

if command -v node &>/dev/null; then
  log "Node.js already installed: $(node --version)"
else
  log "Installing nvm..."
  curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.7/install.sh | bash

  export NVM_DIR="$HOME/.nvm"
  [ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh"

  nvm install 20
  nvm use 20
  nvm alias default 20
  log "Node.js $(node --version) installed"
fi

# ── Install pnpm ──────────────────────────────────────────
header "Installing pnpm"
if command -v pnpm &>/dev/null; then
  log "pnpm already installed: $(pnpm --version)"
else
  npm install -g pnpm
  log "pnpm $(pnpm --version) installed"
fi

# ── Install PM2 ───────────────────────────────────────────
header "Installing PM2"
if command -v pm2 &>/dev/null; then
  log "PM2 already installed: $(pm2 --version)"
else
  npm install -g pm2
  log "PM2 $(pm2 --version) installed"
fi

# ── Install Chromium (Full mode only) ─────────────────────
if [ "$INSTALL_CHROMIUM" = true ]; then
  header "Installing Chromium (Full mode)"

  if command -v chromium-browser &>/dev/null || command -v chromium &>/dev/null; then
    log "Chromium already installed"
  else
    sudo apt-get install -y chromium-browser || sudo apt-get install -y chromium
    log "Chromium installed"
  fi

  # Puppeteer system dependencies
  sudo apt-get install -y \
    libnss3 libatk-bridge2.0-0 libdrm2 libxkbcommon0 libgbm1 \
    libasound2 libxss1 libgtk-3-0 libx11-xcb1 libxcomposite1 \
    libxdamage1 libxrandr2 libpangocairo-1.0-0 libpango-1.0-0 \
    libcairo2 libatspi2.0-0 fonts-liberation 2>/dev/null || true

  log "Chromium and Puppeteer dependencies installed"
else
  log "Skipping Chromium install (not needed for $INSTALL_MODE mode)"
fi

# ── Set up project ────────────────────────────────────────
header "Setting Up Project"

INSTALL_DIR="$HOME/superclaw"

if [ -d "$INSTALL_DIR" ]; then
  warn "Directory $INSTALL_DIR already exists. Updating..."
  cd "$INSTALL_DIR"
else
  mkdir -p "$INSTALL_DIR"
  cd "$INSTALL_DIR"
fi

if [ ! -f "package.json" ]; then
  error "package.json not found in $INSTALL_DIR. Copy your SuperClaw project files here first."
fi

# ── Install dependencies ──────────────────────────────────
header "Installing Node.js Dependencies ($INSTALL_MODE mode)"

if [ -n "$INSTALL_FLAGS" ]; then
  log "Running: pnpm install $INSTALL_FLAGS (skipping optional heavy deps)"
  pnpm install $INSTALL_FLAGS
else
  log "Running: pnpm install (full install including optional deps)"
  pnpm install
fi

log "Dependencies installed"

# ── Run setup wizard ──────────────────────────────────────
header "Running Setup Wizard"

if [ -f ".env" ] && [ -f "superclaw.config.json" ]; then
  warn ".env and superclaw.config.json already exist. Skipping wizard."
  warn "To reconfigure: delete both files and run: npx tsx src/setup/wizard.ts"
else
  log "Starting interactive setup wizard..."
  log "Mode hint: You selected '$INSTALL_MODE' — choose matching platforms in the wizard."
  npx tsx src/setup/wizard.ts
fi

# ── Build TypeScript ──────────────────────────────────────
header "Building TypeScript"
pnpm build
log "TypeScript compiled to dist/"

# ── Configure PM2 ─────────────────────────────────────────
header "Configuring PM2"
mkdir -p logs
pm2 start ecosystem.config.js
pm2 save
pm2 startup | tail -1 | bash || warn "Run 'pm2 startup' manually to enable auto-start on boot."
log "PM2 configured"

# ── Summary ───────────────────────────────────────────────
header "Installation Complete!"

echo -e "${GREEN}SuperClaw ($INSTALL_MODE mode) is running!${NC}\n"

case "$INSTALL_MODE" in
  ultra-lite)
    echo -e "  Mode:     ${GREEN}Ultra-Lite${NC} — Telegram only"
    echo -e "  RAM:      ${GREEN}~110 MB${NC} (vs ~600 MB for OpenClaw)"
    echo -e "  Storage:  ${GREEN}~500 MB${NC}"
    ;;
  standard)
    echo -e "  Mode:     ${GREEN}Standard${NC} — Telegram + WhatsApp (Baileys)"
    echo -e "  RAM:      ${GREEN}~150 MB${NC} (vs ~600 MB for OpenClaw)"
    echo -e "  Storage:  ${GREEN}~600 MB${NC}"
    ;;
  full)
    echo -e "  Mode:     ${YELLOW}Full${NC} — Telegram + WhatsApp (Puppeteer)"
    echo -e "  RAM:      ${YELLOW}~600 MB${NC}"
    echo -e "  Storage:  ${YELLOW}~1.5 GB${NC}"
    ;;
esac

echo ""
echo -e "  PM2 status:   ${CYAN}pm2 status${NC}"
echo -e "  View logs:    ${CYAN}pm2 logs superclaw${NC}"
echo -e "  Stop agent:   ${CYAN}pm2 stop superclaw${NC}"
echo -e "  Restart:      ${CYAN}pm2 restart superclaw${NC}"

if echo "$INSTALL_MODE" | grep -q "standard\|full"; then
  echo -e "\n  First WhatsApp run — check logs for QR code:"
  echo -e "  ${CYAN}pm2 logs superclaw --lines 50${NC}"
fi

echo -e "\n${GREEN}Done!${NC}\n"
