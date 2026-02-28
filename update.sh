#!/bin/bash
# SuperClaw Updater
# Run this on your VPS to pull the latest version and restart

set -e

INSTALL_DIR="${SUPERCLAW_DIR:-/www/wwwroot/superclaw}"

echo ""
echo "╔══════════════════════════════════════╗"
echo "║       SuperClaw Updater              ║"
echo "╚══════════════════════════════════════╝"
echo ""

# Check we're in the right place
if [ ! -f "$INSTALL_DIR/package.json" ]; then
  echo "❌ SuperClaw not found at $INSTALL_DIR"
  echo "   Set SUPERCLAW_DIR env var if installed elsewhere."
  exit 1
fi

cd "$INSTALL_DIR"

# Reset auto-generated files that shouldn't block updates
git checkout -- pnpm-lock.yaml 2>/dev/null || true

echo "📦 Current version: $(node -p "require('./package.json').version" 2>/dev/null || echo 'unknown')"
echo ""

echo "⬇️  Pulling latest changes from GitHub..."
git stash --include-untracked 2>/dev/null || true
git pull
git stash pop 2>/dev/null || true

echo ""
echo "📦 Installing/updating dependencies..."
pnpm install

echo ""
echo "🔨 Building native modules (better-sqlite3)..."
cd "$INSTALL_DIR" && pnpm rebuild better-sqlite3 2>/dev/null || true

echo ""
NEW_VERSION=$(node -p "require('./package.json').version" 2>/dev/null || echo 'unknown')
echo "✅ Updated to v$NEW_VERSION"
echo ""

# Restart PM2 if running
if pm2 list | grep -q "superclaw"; then
  echo "🔄 Restarting SuperClaw via PM2..."
  pm2 restart superclaw
  echo "✅ SuperClaw restarted"
else
  echo "ℹ️  SuperClaw is not running via PM2."
  echo "   Start it with: pm2 start ecosystem.config.js"
fi

echo ""
echo "Done! SuperClaw is now on v$NEW_VERSION"
echo ""
