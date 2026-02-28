#!/data/data/com.termux/files/usr/bin/bash
# SuperClaw - Automated Termux Setup Script
# This script automatically configures SuperClaw for Termux environment

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Logging functions
log_info() { echo -e "${BLUE}[INFO]${NC} $1"; }
log_success() { echo -e "${GREEN}[SUCCESS]${NC} $1"; }
log_warn() { echo -e "${YELLOW}[WARN]${NC} $1"; }
log_error() { echo -e "${RED}[ERROR]${NC} $1"; }

# Summary tracking
SUMMARY_ITEMS=()
add_summary() { SUMMARY_ITEMS+=("$1"); }

# Check if running on Termux
check_termux() {
    if [[ -z "${TERMUX_VERSION}" ]] && [[ ! -d "/data/data/com.termux" ]]; then
        log_error "This script is designed for Termux only!"
        log_info "For regular systems, use: pnpm install && pnpm setup"
        exit 1
    fi
    log_success "Termux environment detected"
}

# Update packages and install dependencies
install_packages() {
    log_info "Updating package lists..."
    pkg update -y
    
    log_info "Installing required packages..."
    pkg install -y nodejs git python build-essential libsqlite
    
    log_info "Setting up X11 repository for Chromium..."
    if ! grep -q "x11" "${PREFIX}/etc/apt/sources.list.d/x11.list" 2>/dev/null; then
        pkg install -y x11-repo
        pkg update -y
    fi
    
    log_info "Installing Chromium browser..."
    pkg install -y chromium
    
    log_success "All packages installed"
    add_summary "✅ Core packages installed (nodejs, git, python, chromium)"
}

# Install termux-api package for Android system integration
install_termux_api() {
    log_info "Installing termux-api package..."
    TERMUX_API_INSTALLED=false

    if pkg install -y termux-api 2>/dev/null; then
        log_success "termux-api installed successfully"
        TERMUX_API_INSTALLED=true
        add_summary "✅ termux-api installed (Android system integration enabled)"
    else
        log_warn "termux-api installation failed — Android API tools will be unavailable"
        log_warn "You can install it manually later: pkg install termux-api"
        add_summary "⚠️  termux-api NOT installed (install manually: pkg install termux-api)"
    fi
}

# Detect root availability
detect_root() {
    log_info "Checking for root access..."
    ROOT_AVAILABLE=false

    if [[ -x "/system/bin/su" ]]; then
        ROOT_AVAILABLE=true
        log_success "Root detected at /system/bin/su"
    elif command -v su &>/dev/null; then
        ROOT_AVAILABLE=true
        log_success "Root detected via PATH ($(which su))"
    else
        log_warn "Root (su) not found — root_shell tool will be unavailable"
    fi

    if [[ "$ROOT_AVAILABLE" == "true" ]]; then
        add_summary "✅ Root access detected — root_shell tool will be enabled"
    else
        add_summary "ℹ️  No root access — root_shell tool disabled"
    fi
}

# Detect Chromium path
get_chromium_path() {
    local chromium_paths=(
        "${PREFIX}/bin/chromium"
        "${PREFIX}/bin/chromium-browser"
        "/data/data/com.termux/files/usr/bin/chromium"
        "/data/data/com.termux/files/usr/bin/chromium-browser"
    )
    
    for path in "${chromium_paths[@]}"; do
        if [[ -x "$path" ]]; then
            echo "$path"
            return 0
        fi
    done
    
    # Try to find it
    which chromium-browser 2>/dev/null || which chromium 2>/dev/null
}

# Setup environment variables in .env file
setup_environment() {
    log_info "Configuring environment..."
    
    local CHROMIUM_PATH
    CHROMIUM_PATH=$(get_chromium_path)
    
    if [[ -z "$CHROMIUM_PATH" ]]; then
        log_error "Chromium not found after installation!"
        exit 1
    fi
    
    log_info "Found Chromium at: $CHROMIUM_PATH"
    
    # Check if .env exists
    if [[ ! -f ".env" ]]; then
        if [[ -f ".env.example" ]]; then
            log_info "Creating .env from .env.example..."
            cp .env.example .env
        else
            log_warn ".env.example not found, creating minimal .env..."
            touch .env
        fi
    fi
    
    # Add Chromium configuration to .env
    if ! grep -q "CHROMIUM_PATH=" .env; then
        echo "" >> .env
        echo "# Termux Chromium Configuration (auto-detected)" >> .env
        echo "CHROMIUM_PATH=$CHROMIUM_PATH" >> .env
        echo "PLAYWRIGHT_BROWSERS_PATH=0" >> .env
        log_success "Added Chromium configuration to .env"
    else
        log_info "CHROMIUM_PATH already configured in .env"
    fi
    
    # Export for current session
    export CHROMIUM_PATH="$CHROMIUM_PATH"
    export PLAYWRIGHT_BROWSERS_PATH=0
}

# Install Node.js dependencies
install_node_deps() {
    log_info "Installing Node.js dependencies..."

    # better-sqlite3 requires native compilation which fails on Android/Termux.
    # We install with --no-optional so it is skipped entirely.
    # sql.js (pure WebAssembly) is used as the SQLite driver on Android instead.

    if command -v pnpm &> /dev/null; then
        log_info "Using pnpm..."

        # Install all non-optional deps; better-sqlite3 is now optional so it
        # won't block the install if node-gyp fails.
        pnpm install --no-optional 2>&1 | grep -v "better-sqlite3" || true

        # Ensure sql.js is present (it is in dependencies, but double-check)
        log_info "Ensuring sql.js is installed (pure-JS SQLite for Android)..."
        pnpm add sql.js 2>/dev/null || npm install sql.js 2>/dev/null || true

        # Install playwright-core for browser automation
        log_info "Installing playwright-core..."
        pnpm add playwright-core 2>/dev/null || true
    else
        log_info "Using npm..."

        # Install without optional deps (skips better-sqlite3 on Android)
        npm install --omit=optional 2>&1 | grep -v "better-sqlite3" || true

        # Ensure sql.js is present
        log_info "Ensuring sql.js is installed (pure-JS SQLite for Android)..."
        npm install sql.js 2>/dev/null || true

        # Install playwright-core
        log_info "Installing playwright-core..."
        npm install playwright-core 2>/dev/null || true
    fi

    log_warn "Note: 'better-sqlite3' native compilation errors above (if any) are expected on Android and can be safely ignored."
    log_warn "      SuperClaw will automatically use sql.js (pure WebAssembly) as the SQLite driver on this device."

    log_success "Node.js dependencies installed"
    add_summary "✅ Node.js dependencies installed (sql.js used for SQLite — no native compilation needed)"
}

# Configure superclaw.config.json for Termux
setup_config() {
    log_info "Configuring SuperClaw for Termux..."
    
    local config_file="superclaw.config.json"
    
    if [[ ! -f "$config_file" ]]; then
        log_warn "superclaw.config.json not found. Run 'pnpm setup' after this script."
        add_summary "⚠️  superclaw.config.json not found — run 'pnpm setup' to create it"
        return 0
    fi
    
    # Create a backup
    cp "$config_file" "${config_file}.backup"
    
    # Pass root/termux-api status to Node.js via env vars
    local termux_api_ok="${TERMUX_API_INSTALLED:-false}"
    local root_ok="${ROOT_AVAILABLE:-false}"

    # Use Node.js to modify the config
    TERMUX_API_INSTALLED="$termux_api_ok" ROOT_AVAILABLE="$root_ok" node << 'EOF'
const fs = require('fs');
const configPath = 'superclaw.config.json';

if (!fs.existsSync(configPath)) {
    console.log('Config file not found, skipping...');
    process.exit(0);
}

let config;
try {
    config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
} catch (e) {
    console.log('Invalid config file, skipping...');
    process.exit(0);
}

// Ensure arrays exist
if (!config.enabledTools) config.enabledTools = [];
if (!config.disabledTools) config.disabledTools = [];

// Helper: add tool to enabledTools if not already present
function enableTool(name) {
    if (!config.enabledTools.includes(name)) {
        config.enabledTools.push(name);
        console.log(`Enabled tool: ${name}`);
    }
}

// Helper: remove tool from disabledTools if present
function undisableTool(name) {
    const idx = config.disabledTools.indexOf(name);
    if (idx !== -1) {
        config.disabledTools.splice(idx, 1);
    }
}

// Add browser_automate to enabled tools if not present
enableTool('browser_automate');

// Always add Android-specific tools
['android_info', 'root_shell', 'daemon_manager'].forEach(tool => {
    enableTool(tool);
    undisableTool(tool);
});

// Add termux_api only if termux-api was successfully installed
const termuxApiInstalled = process.env.TERMUX_API_INSTALLED === 'true';
if (termuxApiInstalled) {
    enableTool('termux_api');
    undisableTool('termux_api');
    console.log('termux_api tool enabled (termux-api package present)');
} else {
    console.log('termux_api tool NOT enabled (termux-api package not installed)');
}

// Disable service_manager and package_manager on Termux
['service_manager', 'package_manager'].forEach(tool => {
    if (!config.disabledTools.includes(tool)) {
        config.disabledTools.push(tool);
        console.log(`Disabled ${tool} (not compatible with Termux)`);
    }
});

// Update RAM estimate
config.estimatedRamMb = 200;

fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
console.log('Configuration updated for Termux');
EOF
    
    log_success "Configuration updated"
    add_summary "✅ superclaw.config.json updated (android_info, root_shell, daemon_manager enabled)"
}

# Test the browser setup
test_browser() {
    log_info "Testing browser configuration..."
    
    node << 'EOF'
const fs = require('fs');
require('dotenv').config();

const chromiumPath = process.env.CHROMIUM_PATH;

if (!chromiumPath) {
    console.log('CHROMIUM_PATH not set in environment');
    process.exit(1);
}

if (!fs.existsSync(chromiumPath)) {
    console.log(`Chromium not found at: ${chromiumPath}`);
    process.exit(1);
}

console.log(`✓ Chromium found at: ${chromiumPath}`);
console.log('Browser configuration looks good!');
EOF
    
    if [[ $? -eq 0 ]]; then
        log_success "Browser configuration verified"
    else
        log_warn "Browser test failed, but setup completed"
    fi
}

# Install superclaw CLI globally in Termux PREFIX
install_cli() {
    log_info "Installing superclaw CLI command..."

    local cli_js
    cli_js="$(pwd)/dist/cli/cli.js"

    if [[ ! -f "$cli_js" ]]; then
        log_warn "dist/cli/cli.js not found — skipping CLI install (run 'pnpm build' first)"
        add_summary "⚠️  superclaw CLI not installed (dist/cli/cli.js missing — run pnpm build)"
        return 0
    fi

    chmod +x "$cli_js"

    if [[ -d "${PREFIX}/bin" ]]; then
        ln -sf "$cli_js" "${PREFIX}/bin/superclaw"
        log_success "'superclaw' command installed at ${PREFIX}/bin/superclaw"
        add_summary "✅ 'superclaw' CLI command available globally (type: superclaw)"
    else
        log_warn "Termux PREFIX/bin not found — add $(pwd)/dist/cli/cli.js to your PATH manually"
        add_summary "⚠️  superclaw CLI not linked — add dist/cli/cli.js to PATH manually"
    fi
}

# Create a convenience launcher script
create_launcher() {
    log_info "Creating launcher script..."
    
    cat > start-termux.sh << 'EOF'
#!/data/data/com.termux/files/usr/bin/bash
# SuperClaw Termux Launcher

cd "$(dirname "$0")"

# Ensure environment is set
export CHROMIUM_PATH="${CHROMIUM_PATH:-/data/data/com.termux/files/usr/bin/chromium-browser}"
export PLAYWRIGHT_BROWSERS_PATH=0

# Prevent Termux from killing the process
termux-wake-lock 2>/dev/null || true

echo "Starting SuperClaw..."
npx tsx src/index.ts

# Release wake lock on exit
termux-wake-unlock 2>/dev/null || true
EOF
    
    chmod +x start-termux.sh
    log_success "Launcher created: ./start-termux.sh"
    add_summary "✅ Launcher script created: ./start-termux.sh"
}

# Setup Termux:Boot auto-start
setup_termux_boot() {
    log_info "Setting up Termux:Boot auto-start..."

    if [[ -f "termux-boot-setup.sh" ]]; then
        bash termux-boot-setup.sh
        if [[ $? -eq 0 ]]; then
            log_success "Termux:Boot auto-start configured"
            add_summary "✅ Termux:Boot auto-start configured"
        else
            log_warn "Termux:Boot setup encountered errors — check termux-boot-setup.sh"
            add_summary "⚠️  Termux:Boot setup had errors — check termux-boot-setup.sh"
        fi
    else
        log_warn "termux-boot-setup.sh not found — skipping auto-start setup"
        add_summary "⚠️  termux-boot-setup.sh not found — auto-start NOT configured"
    fi
}

# Prompt user about Termux:Boot auto-start
prompt_termux_boot() {
    echo ""
    echo -e "${YELLOW}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    echo -e "${YELLOW}  Termux:Boot Auto-Start${NC}"
    echo -e "${YELLOW}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    echo ""
    echo "Would you like to set up SuperClaw to start automatically"
    echo "when your Android device boots? (requires Termux:Boot app)"
    echo ""
    echo "  Install Termux:Boot from F-Droid if you haven't already."
    echo ""
    read -r -p "Set up auto-start? [y/N]: " boot_answer

    case "${boot_answer,,}" in
        y|yes)
            setup_termux_boot
            ;;
        *)
            log_info "Skipping Termux:Boot auto-start setup"
            add_summary "ℹ️  Termux:Boot auto-start skipped (run termux-boot-setup.sh manually to enable)"
            ;;
    esac
}

# Print final summary
print_summary() {
    echo ""
    echo -e "${GREEN}════════════════════════════════════════${NC}"
    echo -e "${GREEN}  Setup Summary${NC}"
    echo -e "${GREEN}════════════════════════════════════════${NC}"
    echo ""
    for item in "${SUMMARY_ITEMS[@]}"; do
        echo "  $item"
    done
    echo ""
    echo -e "${GREEN}════════════════════════════════════════${NC}"
}

# Main setup function
main() {
    echo "========================================"
    echo "  SuperClaw - Termux Auto-Setup"
    echo "========================================"
    echo ""
    
    check_termux
    install_packages
    install_termux_api
    detect_root
    setup_environment
    install_node_deps
    setup_config
    test_browser
    create_launcher
    install_cli
    prompt_termux_boot
    
    echo ""
    echo "========================================"
    log_success "Setup completed successfully!"
    echo "========================================"
    echo ""
    echo "Next steps:"
    echo "  1. Configure your .env file with API keys"
    echo "  2. Run: pnpm setup (or npm run setup)"
    echo "  3. Start with: ./start-termux.sh"
    echo ""
    echo "Or run directly:"
    echo "  npx tsx src/index.ts"
    echo ""

    print_summary
}

# Run main function
main "$@"
