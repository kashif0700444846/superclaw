<?php
// =============================================================================
// SuperClaw PHP Setup Wizard
// Delete this file after setup is complete for security.
// =============================================================================

// Fix 1: Suppress PHP errors from corrupting JSON responses
ini_set('display_errors', 0);
error_reporting(0);

session_start();

define('SETUP_PASSWORD', 'superclaw'); // Change this before deploying!
define('PROJECT_ROOT', dirname(__DIR__));
define('ENV_FILE', PROJECT_ROOT . '/.env');
define('DIST_DIR', PROJECT_ROOT . '/dist');

// ---------------------------------------------------------------------------
// Fix 4: Helper — find a binary by checking common paths
// ---------------------------------------------------------------------------
function findBinary(string $name): string {
    $paths = [
        "/usr/local/bin/{$name}",
        "/usr/bin/{$name}",
        "/bin/{$name}",
        "/root/.nvm/versions/node/v20.15.1/bin/{$name}",
        "/root/.nvm/versions/node/v20.18.0/bin/{$name}",
        "/root/.nvm/versions/node/v22.0.0/bin/{$name}",
        "/usr/local/node/bin/{$name}",
        "/root/.local/share/pnpm/{$name}",
        "/usr/local/pnpm/{$name}",
    ];
    foreach ($paths as $path) {
        if (file_exists($path) && is_executable($path)) {
            return $path;
        }
    }
    return $name; // fallback to PATH lookup
}

// Fix 6: Check whether shell_exec is available and not disabled
function canRunShell(): bool {
    if (!function_exists('shell_exec')) {
        return false;
    }
    $disabled = array_map('trim', explode(',', (string) ini_get('disable_functions')));
    return !in_array('shell_exec', $disabled, true);
}

// ---------------------------------------------------------------------------
// AJAX Action Handlers
// ---------------------------------------------------------------------------
if (isset($_GET['action'])) {
    // Fix 2: Buffer all output so stray warnings cannot corrupt JSON
    ob_start();
    header('Content-Type: application/json');

    // Auth check for all actions
    if (!isset($_SESSION['setup_auth'])) {
        ob_end_clean();
        echo json_encode(['error' => 'Unauthorized']);
        exit;
    }

    // Fix 4: Ensure common binary directories are on PATH for shell_exec
    putenv('PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin'
        . ':/root/.nvm/versions/node/v20.15.1/bin'
        . ':/root/.nvm/versions/node/v20.18.0/bin'
        . ':/root/.nvm/versions/node/v22.0.0/bin'
        . ':/usr/local/node/bin'
        . ':/root/.local/share/pnpm'
        . ':/usr/local/pnpm');

    $action = $_GET['action'];

    try {
        switch ($action) {

            case 'status':
                ob_end_clean();

                if (!canRunShell()) {
                    echo json_encode([
                        'node'       => 'shell_exec disabled',
                        'pnpm'       => 'shell_exec disabled',
                        'git'        => 'shell_exec disabled',
                        'env'        => file_exists(ENV_FILE),
                        'dist'       => is_dir(DIST_DIR),
                        'running'    => false,
                        'pm2_output' => '',
                        'shell_disabled' => true,
                        'shell_disabled_msg' => 'shell_exec is disabled in PHP. Enable it in aaPanel → PHP → Disable Functions.',
                    ]);
                    break;
                }

                $node    = findBinary('node');
                $pnpm    = findBinary('pnpm');
                $git     = findBinary('git');
                $pm2     = findBinary('pm2');

                $nodeVersion = @shell_exec("{$node} --version 2>/dev/null");
                $pnpmVersion = @shell_exec("{$pnpm} --version 2>/dev/null");
                $gitVersion  = @shell_exec("{$git} --version 2>/dev/null");
                $pm2List     = @shell_exec("{$pm2} list 2>/dev/null");
                $pm2Status   = @shell_exec("{$pm2} list 2>/dev/null | grep superclaw");

                $envExists  = file_exists(ENV_FILE);
                $distExists = is_dir(DIST_DIR);
                $scRunning  = $pm2Status
                    ? (strpos($pm2Status, 'online') !== false)
                    : false;

                echo json_encode([
                    'node'       => $nodeVersion ? trim($nodeVersion) : 'Not found',
                    'pnpm'       => $pnpmVersion ? trim($pnpmVersion) : 'Not found',
                    'git'        => $gitVersion  ? trim($gitVersion)  : 'Not found',
                    'env'        => $envExists,
                    'dist'       => $distExists,
                    'running'    => $scRunning,
                    'pm2_output' => $pm2List ? trim($pm2List) : '',
                ]);
                break;

            case 'install':
                ob_end_clean();
                set_time_limit(300);

                if (!canRunShell()) {
                    echo json_encode(['error' => 'shell_exec is disabled. Enable it in aaPanel → PHP → Disable Functions.', 'output' => '']);
                    break;
                }

                $pnpm   = findBinary('pnpm');
                $output = @shell_exec('cd ' . escapeshellarg(PROJECT_ROOT) . " && {$pnpm} install 2>&1");
                echo json_encode(['output' => $output ?: 'No output (shell_exec may be disabled)', 'success' => true]);
                break;

            case 'build':
                ob_end_clean();
                set_time_limit(300);

                if (!canRunShell()) {
                    echo json_encode(['error' => 'shell_exec is disabled. Enable it in aaPanel → PHP → Disable Functions.', 'output' => '']);
                    break;
                }

                $pnpm   = findBinary('pnpm');
                $output = @shell_exec('cd ' . escapeshellarg(PROJECT_ROOT) . " && {$pnpm} build 2>&1");
                echo json_encode(['output' => $output ?: 'No output (shell_exec may be disabled)', 'success' => true]);
                break;

            case 'configure':
                ob_end_clean();
                $provider  = $_POST['ai_provider']       ?? 'openai';
                $apiKey    = $_POST['api_key']           ?? '';
                $model     = $_POST['ai_model']          ?? 'gpt-4o';
                $tgToken   = $_POST['telegram_token']    ?? '';
                $tgAdminId = $_POST['admin_telegram_id'] ?? '';
                $agentName = $_POST['agent_name']        ?? 'SuperClaw';
                $waEnabled = isset($_POST['whatsapp_enabled']) && $_POST['whatsapp_enabled'] === '1';
                $waNumber  = $_POST['whatsapp_number']   ?? '';
                $hostname  = canRunShell()
                    ? (trim((string) @shell_exec('hostname 2>/dev/null')) ?: 'my-vps')
                    : 'my-vps';

                // Build provider-specific key lines
                $providerKeys = '';
                switch ($provider) {
                    case 'openai':
                        $providerKeys = "OPENAI_API_KEY={$apiKey}";
                        break;
                    case 'anthropic':
                        $providerKeys = "ANTHROPIC_API_KEY={$apiKey}";
                        break;
                    case 'groq':
                        $providerKeys = "GROQ_API_KEY={$apiKey}";
                        break;
                    case 'ollama':
                        $providerKeys = "OLLAMA_BASE_URL={$apiKey}";
                        break;
                    case 'custom':
                        $providerKeys = "CUSTOM_AI_BASE_URL={$apiKey}\nCUSTOM_AI_API_KEY=\nCUSTOM_AI_MODEL={$model}";
                        break;
                }

                $waLine = $waEnabled
                    ? "ADMIN_WHATSAPP_NUMBER={$waNumber}\nADMIN_WHATSAPP_NUMBERS="
                    : "ADMIN_WHATSAPP_NUMBER=\nADMIN_WHATSAPP_NUMBERS=";

                $env = <<<ENV
# ============================================================
# SuperClaw — Environment Configuration
# Generated by PHP Setup Wizard
# ============================================================

# --- AI Provider ---
# Options: openai | anthropic | groq | ollama | custom
AI_PROVIDER={$provider}

# API Keys (only the relevant one is set)
OPENAI_API_KEY=
ANTHROPIC_API_KEY=
GROQ_API_KEY=
OLLAMA_BASE_URL=http://localhost:11434
CUSTOM_AI_BASE_URL=https://your-api-endpoint.com/v1
CUSTOM_AI_MODEL=gpt-4o
CUSTOM_AI_API_KEY=

# Active provider key
{$providerKeys}

# AI Model
AI_MODEL={$model}

# --- Telegram ---
TELEGRAM_BOT_TOKEN={$tgToken}
ADMIN_TELEGRAM_ID={$tgAdminId}

# --- WhatsApp ---
WHATSAPP_SESSION_NAME=superclaw
{$waLine}

# --- Agent Identity ---
AGENT_NAME={$agentName}

# --- VPS Info ---
VPS_HOSTNAME={$hostname}

# --- Logging ---
LOG_LEVEL=info

# --- Database ---
DB_PATH=./data/superclaw.db

# --- Optional: SerpAPI for web search ---
SERPAPI_KEY=

# --- Optional: Browser Automation ---
CHROMIUM_PATH=
PLAYWRIGHT_BROWSERS_PATH=

# --- Rate limiting ---
MAX_MESSAGES_PER_MINUTE=30
MAX_AI_CALLS_PER_MINUTE=10
MAX_CONCURRENT_TOOLS=5

# --- Sub-agent settings ---
MAX_CONCURRENT_AGENTS=5
SUBAGENT_TIMEOUT_MS=600000
ENV;

                $written = file_put_contents(ENV_FILE, $env);
                if ($written !== false) {
                    echo json_encode(['success' => true, 'message' => '.env file written successfully.']);
                } else {
                    echo json_encode(['error' => 'Failed to write .env file. Check PHP write permissions on ' . PROJECT_ROOT]);
                }
                break;

            case 'start_pm2':
                ob_end_clean();
                set_time_limit(60);

                if (!canRunShell()) {
                    echo json_encode(['error' => 'shell_exec is disabled. Enable it in aaPanel → PHP → Disable Functions.', 'output' => '']);
                    break;
                }

                $pm2    = findBinary('pm2');
                $output = @shell_exec('cd ' . escapeshellarg(PROJECT_ROOT) . " && {$pm2} start ecosystem.config.js 2>&1 && {$pm2} save 2>&1");
                echo json_encode(['output' => $output ?: 'No output (shell_exec may be disabled)']);
                break;

            default:
                ob_end_clean();
                echo json_encode(['error' => 'Unknown action']);
        }
    } catch (Exception $e) {
        ob_end_clean();
        echo json_encode(['error' => $e->getMessage()]);
    }
    exit;
}

// ---------------------------------------------------------------------------
// Auth handling (page load)
// ---------------------------------------------------------------------------
$authError = false;
if ($_SERVER['REQUEST_METHOD'] === 'POST' && isset($_POST['setup_password'])) {
    if ($_POST['setup_password'] === SETUP_PASSWORD) {
        $_SESSION['setup_auth'] = true;
    } else {
        $authError = true;
    }
}

$isAuthed   = isset($_SESSION['setup_auth']) && $_SESSION['setup_auth'] === true;
$envExists  = file_exists(ENV_FILE);
$distExists = is_dir(DIST_DIR);
$setupDone  = $envExists && $distExists;
?>
<!DOCTYPE html>
<html lang="en" class="dark">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>SuperClaw — Setup Wizard</title>
<script src="https://cdn.tailwindcss.com"></script>
<script>
  tailwind.config = {
    darkMode: 'class',
    theme: {
      extend: {
        colors: {
          brand: {
            50:  '#f0fdf9',
            100: '#ccfbef',
            200: '#99f6e0',
            300: '#5eead4',
            400: '#2dd4bf',
            500: '#14b8a6',
            600: '#0d9488',
            700: '#0f766e',
            800: '#115e59',
            900: '#134e4a',
          }
        }
      }
    }
  }
</script>
<style>
  /* Scrollbar styling */
  ::-webkit-scrollbar { width: 6px; height: 6px; }
  ::-webkit-scrollbar-track { background: #1e293b; }
  ::-webkit-scrollbar-thumb { background: #0d9488; border-radius: 3px; }

  /* Spinner */
  @keyframes spin { to { transform: rotate(360deg); } }
  .spinner { animation: spin 0.8s linear infinite; }

  /* Step transition */
  .step-panel { display: none; }
  .step-panel.active { display: block; }

  /* Terminal output */
  .terminal {
    background: #0a0f1a;
    color: #4ade80;
    font-family: 'Courier New', monospace;
    font-size: 0.8rem;
    line-height: 1.5;
    border: 1px solid #1e3a3a;
    border-radius: 0.5rem;
    padding: 1rem;
    max-height: 320px;
    overflow-y: auto;
    white-space: pre-wrap;
    word-break: break-all;
  }

  /* Card hover */
  .launch-card { transition: border-color 0.2s, box-shadow 0.2s; }
  .launch-card:hover { border-color: #14b8a6; box-shadow: 0 0 0 1px #14b8a6; }

  /* Toggle switch */
  .toggle-checkbox:checked { right: 0; border-color: #14b8a6; }
  .toggle-checkbox:checked + .toggle-label { background-color: #14b8a6; }
</style>
</head>
<body class="bg-gray-950 text-gray-100 min-h-screen font-sans antialiased">

<!-- =========================================================
     LIGHT/DARK TOGGLE
     ========================================================= -->
<div class="fixed top-4 right-4 z-50">
  <button id="themeToggle"
    class="p-2 rounded-full bg-gray-800 hover:bg-gray-700 border border-gray-700 text-gray-300 hover:text-white transition-all"
    title="Toggle light/dark mode">
    <svg id="iconMoon" xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
        d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z"/>
    </svg>
    <svg id="iconSun" xmlns="http://www.w3.org/2000/svg" class="h-5 w-5 hidden" fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
        d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364-6.364l-.707.707M6.343 17.657l-.707.707M17.657 17.657l-.707-.707M6.343 6.343l-.707-.707M12 8a4 4 0 100 8 4 4 0 000-8z"/>
    </svg>
  </button>
</div>

<!-- =========================================================
     AUTH GATE
     ========================================================= -->
<?php if (!$isAuthed): ?>
<div class="min-h-screen flex items-center justify-center px-4">
  <div class="w-full max-w-md">
    <!-- Logo -->
    <div class="text-center mb-8">
      <div class="inline-flex items-center justify-center w-20 h-20 rounded-2xl bg-brand-900 border border-brand-700 mb-4">
        <span class="text-4xl">🦞</span>
      </div>
      <h1 class="text-3xl font-bold text-white">SuperClaw</h1>
      <p class="text-gray-400 mt-1">Setup Wizard</p>
    </div>

    <!-- Auth card -->
    <div class="bg-gray-900 border border-gray-800 rounded-2xl p-8 shadow-2xl">
      <h2 class="text-xl font-semibold text-white mb-2">Access Required</h2>
      <p class="text-gray-400 text-sm mb-6">Enter the setup password to continue. Default: <code class="text-brand-400 bg-gray-800 px-1 rounded">superclaw</code></p>

      <?php if ($authError): ?>
      <div class="mb-4 p-3 rounded-lg bg-red-900/40 border border-red-700 text-red-300 text-sm">
        ❌ Incorrect password. Please try again.
      </div>
      <?php endif; ?>

      <form method="POST" action="">
        <div class="mb-4">
          <label class="block text-sm font-medium text-gray-300 mb-2">Setup Password</label>
          <div class="relative">
            <input type="password" name="setup_password" id="authPassword"
              class="w-full bg-gray-800 border border-gray-700 rounded-lg px-4 py-3 text-white placeholder-gray-500 focus:outline-none focus:border-brand-500 focus:ring-1 focus:ring-brand-500 pr-12"
              placeholder="Enter password" autofocus required />
            <button type="button" onclick="toggleAuthPw()"
              class="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-200">
              <svg id="authEyeIcon" xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"/>
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z"/>
              </svg>
            </button>
          </div>
        </div>
        <button type="submit"
          class="w-full bg-brand-600 hover:bg-brand-500 text-white font-semibold py-3 px-6 rounded-lg transition-colors">
          Enter Setup →
        </button>
      </form>
    </div>

    <p class="text-center text-gray-600 text-xs mt-6">
      Change the password in <code class="text-gray-500">setup/index.php</code> → <code class="text-gray-500">SETUP_PASSWORD</code>
    </p>
  </div>
</div>

<?php elseif ($setupDone): ?>
<!-- =========================================================
     SETUP COMPLETE PAGE
     ========================================================= -->
<div class="min-h-screen flex items-center justify-center px-4">
  <div class="w-full max-w-2xl text-center">
    <div class="inline-flex items-center justify-center w-24 h-24 rounded-2xl bg-brand-900 border border-brand-700 mb-6">
      <span class="text-5xl">✅</span>
    </div>
    <h1 class="text-4xl font-bold text-white mb-3">Setup Complete!</h1>
    <p class="text-gray-400 text-lg mb-8">SuperClaw is configured and built. Here's how to access it.</p>

    <div class="grid gap-4 text-left mb-8">
      <div class="bg-gray-900 border border-gray-800 rounded-xl p-5">
        <h3 class="font-semibold text-brand-400 mb-2">🤖 Telegram Bot</h3>
        <p class="text-gray-300 text-sm">Open Telegram and send a message to your bot. It should respond if SuperClaw is running.</p>
      </div>
      <div class="bg-gray-900 border border-gray-800 rounded-xl p-5">
        <h3 class="font-semibold text-brand-400 mb-2">🖥️ Web Admin Panel</h3>
        <p class="text-gray-300 text-sm mb-2">If the web server is enabled, access it at:</p>
        <code class="text-brand-300 bg-gray-800 px-3 py-1 rounded text-sm">http://&lt;your-server-ip&gt;:3000</code>
      </div>
      <div class="bg-gray-900 border border-gray-800 rounded-xl p-5">
        <h3 class="font-semibold text-brand-400 mb-2">📋 PM2 Status</h3>
        <p class="text-gray-300 text-sm mb-2">Check if SuperClaw is running:</p>
        <code class="text-brand-300 bg-gray-800 px-3 py-1 rounded text-sm">pm2 list</code>
      </div>
    </div>

    <div class="bg-yellow-900/30 border border-yellow-700/50 rounded-xl p-4 text-left mb-6">
      <p class="text-yellow-300 text-sm">
        <strong>⚠️ Security:</strong> Delete <code class="bg-yellow-900/50 px-1 rounded">setup/index.php</code> from your server after setup is complete to prevent unauthorized access.
      </p>
    </div>

    <a href="?force=1"
      class="inline-block bg-gray-800 hover:bg-gray-700 text-gray-300 font-medium py-2 px-6 rounded-lg transition-colors text-sm">
      Re-run Setup Wizard
    </a>
  </div>
</div>

<?php else: ?>
<!-- =========================================================
     MAIN WIZARD
     ========================================================= -->
<div class="max-w-3xl mx-auto px-4 py-10">

  <!-- Header -->
  <div class="text-center mb-10">
    <div class="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-brand-900 border border-brand-700 mb-4">
      <span class="text-3xl">🦞</span>
    </div>
    <h1 class="text-3xl font-bold text-white">SuperClaw Setup</h1>
    <p class="text-gray-400 mt-1 text-sm">Web-based configuration wizard</p>
  </div>

  <!-- Progress Bar -->
  <div class="mb-10">
    <div class="flex items-center justify-between mb-3">
      <?php
      $steps = ['System Check', 'Dependencies', 'Configure', 'Build', 'Launch'];
      foreach ($steps as $i => $label):
        $num = $i + 1;
      ?>
      <div class="flex flex-col items-center flex-1">
        <div id="step-dot-<?= $num ?>"
          class="w-9 h-9 rounded-full flex items-center justify-center text-sm font-bold border-2 transition-all duration-300
          <?= $num === 1 ? 'bg-brand-600 border-brand-500 text-white' : 'bg-gray-800 border-gray-700 text-gray-500' ?>">
          <span id="step-dot-num-<?= $num ?>"><?= $num ?></span>
          <svg id="step-dot-check-<?= $num ?>" xmlns="http://www.w3.org/2000/svg" class="h-4 w-4 hidden" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="3" d="M5 13l4 4L19 7"/>
          </svg>
        </div>
        <span id="step-label-<?= $num ?>" class="text-xs mt-1 <?= $num === 1 ? 'text-brand-400' : 'text-gray-600' ?> hidden sm:block text-center"><?= $label ?></span>
      </div>
      <?php if ($num < 5): ?>
      <div id="step-line-<?= $num ?>" class="flex-1 h-0.5 bg-gray-800 mx-1 transition-all duration-500 max-w-[60px]"></div>
      <?php endif; ?>
      <?php endforeach; ?>
    </div>
  </div>

  <!-- =====================================================
       STEP 1 — System Check
       ===================================================== -->
  <div id="step-1" class="step-panel active">
    <div class="bg-gray-900 border border-gray-800 rounded-2xl p-6 mb-6">
      <h2 class="text-xl font-semibold text-white mb-1">Step 1 — System Check</h2>
      <p class="text-gray-400 text-sm mb-6">Verifying your server environment before we begin.</p>

      <!-- Status table -->
      <div class="overflow-hidden rounded-xl border border-gray-800 mb-6">
        <table class="w-full text-sm">
          <thead>
            <tr class="bg-gray-800/60">
              <th class="text-left px-4 py-3 text-gray-400 font-medium">Requirement</th>
              <th class="text-left px-4 py-3 text-gray-400 font-medium">Status</th>
              <th class="text-left px-4 py-3 text-gray-400 font-medium">Details</th>
            </tr>
          </thead>
          <tbody id="statusTable" class="divide-y divide-gray-800">
            <tr>
              <td colspan="3" class="px-4 py-6 text-center text-gray-500">
                <div class="flex items-center justify-center gap-2">
                  <svg class="spinner h-4 w-4 text-brand-400" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                    <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
                    <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path>
                  </svg>
                  Checking system...
                </div>
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <!-- Action buttons -->
      <div class="flex flex-col sm:flex-row gap-3">
        <button id="btnStartSetup"
          class="flex-1 bg-brand-600 hover:bg-brand-500 disabled:opacity-40 disabled:cursor-not-allowed text-white font-semibold py-3 px-6 rounded-xl transition-colors"
          disabled>
          Start Web Setup →
        </button>
        <button id="btnTerminal"
          class="flex-1 bg-gray-800 hover:bg-gray-700 text-gray-300 font-medium py-3 px-6 rounded-xl transition-colors border border-gray-700">
          I'll Use Terminal
        </button>
      </div>
    </div>

    <!-- Terminal commands panel (hidden by default) -->
    <div id="terminalPanel" class="hidden bg-gray-900 border border-gray-800 rounded-2xl p-6">
      <h3 class="font-semibold text-white mb-3">Terminal Setup Commands</h3>
      <p class="text-gray-400 text-sm mb-4">Run these commands on your VPS via SSH:</p>
      <div class="terminal"><?php
$root = PROJECT_ROOT;
echo htmlspecialchars(
"cd {$root}
pnpm install
cp .env.example .env
nano .env          # Edit your configuration
pnpm build
pm2 start ecosystem.config.js
pm2 save
pm2 startup"
);
?></div>
    </div>
  </div>

  <!-- =====================================================
       STEP 2 — Install Dependencies
       ===================================================== -->
  <div id="step-2" class="step-panel">
    <div class="bg-gray-900 border border-gray-800 rounded-2xl p-6">
      <h2 class="text-xl font-semibold text-white mb-1">Step 2 — Install Dependencies</h2>
      <p class="text-gray-400 text-sm mb-6">
        Run <code class="text-brand-400 bg-gray-800 px-1 rounded">pnpm install</code> to download all Node.js packages.
        This may take 1–3 minutes.
      </p>

      <div id="installStatus" class="hidden mb-4 p-3 rounded-lg text-sm"></div>

      <button id="btnInstall"
        class="w-full bg-brand-600 hover:bg-brand-500 text-white font-semibold py-3 px-6 rounded-xl transition-colors flex items-center justify-center gap-2 mb-4">
        <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"/>
        </svg>
        Install Dependencies (pnpm install)
      </button>

      <div id="installOutput" class="hidden">
        <div class="flex items-center gap-2 mb-2">
          <svg id="installSpinner" class="spinner h-4 w-4 text-brand-400 hidden" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
            <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
            <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path>
          </svg>
          <span id="installOutputLabel" class="text-xs text-gray-400">Output:</span>
        </div>
        <pre id="installOutputPre" class="terminal"></pre>
      </div>

      <div id="installNextWrap" class="hidden mt-4">
        <button id="btnInstallNext"
          class="w-full bg-brand-600 hover:bg-brand-500 text-white font-semibold py-3 px-6 rounded-xl transition-colors">
          Next: Configure →
        </button>
      </div>
    </div>
  </div>

  <!-- =====================================================
       STEP 3 — Configure
       ===================================================== -->
  <div id="step-3" class="step-panel">
    <div class="bg-gray-900 border border-gray-800 rounded-2xl p-6">
      <h2 class="text-xl font-semibold text-white mb-1">Step 3 — Configure</h2>
      <p class="text-gray-400 text-sm mb-6">Fill in your credentials. This will write the <code class="text-brand-400 bg-gray-800 px-1 rounded">.env</code> file.</p>

      <div id="configStatus" class="hidden mb-4 p-3 rounded-lg text-sm"></div>

      <form id="configForm" class="space-y-5">

        <!-- AI Provider -->
        <div>
          <label class="block text-sm font-medium text-gray-300 mb-2">AI Provider</label>
          <select id="aiProvider" name="ai_provider"
            class="w-full bg-gray-800 border border-gray-700 rounded-lg px-4 py-3 text-white focus:outline-none focus:border-brand-500 focus:ring-1 focus:ring-brand-500">
            <option value="openai">OpenAI (GPT-4o, GPT-4, etc.)</option>
            <option value="anthropic">Anthropic (Claude)</option>
            <option value="groq">Groq (Fast inference)</option>
            <option value="ollama">Ollama (Local models)</option>
            <option value="custom">Custom / OpenRouter</option>
          </select>
        </div>

        <!-- API Key -->
        <div>
          <label class="block text-sm font-medium text-gray-300 mb-2" id="apiKeyLabel">API Key</label>
          <div class="relative">
            <input type="password" id="apiKey" name="api_key"
              class="w-full bg-gray-800 border border-gray-700 rounded-lg px-4 py-3 text-white placeholder-gray-500 focus:outline-none focus:border-brand-500 focus:ring-1 focus:ring-brand-500 pr-12"
              placeholder="sk-..." />
            <button type="button" onclick="toggleApiKey()"
              class="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-200">
              <svg id="apiEyeIcon" xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"/>
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z"/>
              </svg>
            </button>
          </div>
          <p id="apiKeyHint" class="text-xs text-gray-500 mt-1">Get your key from platform.openai.com</p>
        </div>

        <!-- AI Model -->
        <div>
          <label class="block text-sm font-medium text-gray-300 mb-2">AI Model</label>
          <input type="text" id="aiModel" name="ai_model" value="gpt-4o"
            class="w-full bg-gray-800 border border-gray-700 rounded-lg px-4 py-3 text-white placeholder-gray-500 focus:outline-none focus:border-brand-500 focus:ring-1 focus:ring-brand-500"
            placeholder="gpt-4o" />
          <p class="text-xs text-gray-500 mt-1">Auto-filled based on provider. You can override this.</p>
        </div>

        <!-- Divider -->
        <div class="border-t border-gray-800 pt-2">
          <p class="text-xs text-gray-500 uppercase tracking-wider font-medium mb-4">Telegram</p>
        </div>

        <!-- Telegram Token -->
        <div>
          <label class="block text-sm font-medium text-gray-300 mb-2">Telegram Bot Token</label>
          <input type="text" id="telegramToken" name="telegram_token"
            class="w-full bg-gray-800 border border-gray-700 rounded-lg px-4 py-3 text-white placeholder-gray-500 focus:outline-none focus:border-brand-500 focus:ring-1 focus:ring-brand-500"
            placeholder="123456789:ABC..." />
          <p class="text-xs text-gray-500 mt-1">Get from <a href="https://t.me/BotFather" target="_blank" class="text-brand-400 hover:underline">@BotFather</a> on Telegram</p>
        </div>

        <!-- Admin Telegram ID -->
        <div>
          <label class="block text-sm font-medium text-gray-300 mb-2">Admin Telegram ID</label>
          <input type="text" id="adminTelegramId" name="admin_telegram_id"
            class="w-full bg-gray-800 border border-gray-700 rounded-lg px-4 py-3 text-white placeholder-gray-500 focus:outline-none focus:border-brand-500 focus:ring-1 focus:ring-brand-500"
            placeholder="123456789" />
          <p class="text-xs text-gray-500 mt-1">Get your ID from <a href="https://t.me/userinfobot" target="_blank" class="text-brand-400 hover:underline">@userinfobot</a>. Comma-separate for multiple admins.</p>
        </div>

        <!-- Divider -->
        <div class="border-t border-gray-800 pt-2">
          <p class="text-xs text-gray-500 uppercase tracking-wider font-medium mb-4">Agent</p>
        </div>

        <!-- Agent Name -->
        <div>
          <label class="block text-sm font-medium text-gray-300 mb-2">Agent Name</label>
          <input type="text" id="agentName" name="agent_name" value="SuperClaw"
            class="w-full bg-gray-800 border border-gray-700 rounded-lg px-4 py-3 text-white placeholder-gray-500 focus:outline-none focus:border-brand-500 focus:ring-1 focus:ring-brand-500"
            placeholder="SuperClaw" />
        </div>

        <!-- WhatsApp Toggle -->
        <div class="flex items-center justify-between p-4 bg-gray-800/50 rounded-xl border border-gray-700">
          <div>
            <p class="text-sm font-medium text-gray-300">Enable WhatsApp</p>
            <p class="text-xs text-gray-500 mt-0.5">Connect via WhatsApp in addition to Telegram</p>
          </div>
          <label class="relative inline-flex items-center cursor-pointer">
            <input type="checkbox" id="waToggle" class="sr-only" onchange="toggleWhatsApp(this)">
            <div id="waToggleTrack" class="w-11 h-6 bg-gray-700 rounded-full transition-colors duration-200"></div>
            <div id="waToggleThumb" class="absolute left-0.5 top-0.5 w-5 h-5 bg-gray-400 rounded-full transition-transform duration-200"></div>
          </label>
        </div>

        <!-- WhatsApp Number (hidden by default) -->
        <div id="waNumberWrap" class="hidden">
          <label class="block text-sm font-medium text-gray-300 mb-2">Admin WhatsApp Number</label>
          <input type="text" id="waNumber" name="whatsapp_number"
            class="w-full bg-gray-800 border border-gray-700 rounded-lg px-4 py-3 text-white placeholder-gray-500 focus:outline-none focus:border-brand-500 focus:ring-1 focus:ring-brand-500"
            placeholder="15551234567@c.us" />
          <p class="text-xs text-gray-500 mt-1">Format: <code class="text-brand-400">countrycode+number@c.us</code> (e.g. 15551234567@c.us)</p>
          <input type="hidden" name="whatsapp_enabled" id="waEnabledInput" value="0">
        </div>

        <button type="submit"
          class="w-full bg-brand-600 hover:bg-brand-500 text-white font-semibold py-3 px-6 rounded-xl transition-colors flex items-center justify-center gap-2">
          <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 7H5a2 2 0 00-2 2v9a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-3m-1 4l-3 3m0 0l-3-3m3 3V4"/>
          </svg>
          Save Configuration (.env)
        </button>
      </form>

      <div id="configNextWrap" class="hidden mt-4">
        <button id="btnConfigNext"
          class="w-full bg-brand-600 hover:bg-brand-500 text-white font-semibold py-3 px-6 rounded-xl transition-colors">
          Next: Build →
        </button>
      </div>
    </div>
  </div>

  <!-- =====================================================
       STEP 4 — Build
       ===================================================== -->
  <div id="step-4" class="step-panel">
    <div class="bg-gray-900 border border-gray-800 rounded-2xl p-6">
      <h2 class="text-xl font-semibold text-white mb-1">Step 4 — Build</h2>
      <p class="text-gray-400 text-sm mb-6">
        Compile TypeScript to JavaScript. Runs <code class="text-brand-400 bg-gray-800 px-1 rounded">pnpm build</code>.
        This usually takes 10–30 seconds.
      </p>

      <div id="buildStatus" class="hidden mb-4 p-3 rounded-lg text-sm"></div>

      <button id="btnBuild"
        class="w-full bg-brand-600 hover:bg-brand-500 text-white font-semibold py-3 px-6 rounded-xl transition-colors flex items-center justify-center gap-2 mb-4">
        <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"/>
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"/>
        </svg>
        Build SuperClaw (pnpm build)
      </button>

      <div id="buildOutput" class="hidden">
        <div class="flex items-center gap-2 mb-2">
          <svg id="buildSpinner" class="spinner h-4 w-4 text-brand-400 hidden" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
            <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
            <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path>
          </svg>
          <span id="buildOutputLabel" class="text-xs text-gray-400">Output:</span>
        </div>
        <pre id="buildOutputPre" class="terminal"></pre>
      </div>

      <div id="buildNextWrap" class="hidden mt-4">
        <button id="btnBuildNext"
          class="w-full bg-brand-600 hover:bg-brand-500 text-white font-semibold py-3 px-6 rounded-xl transition-colors">
          Next: Launch →
        </button>
      </div>
    </div>
  </div>

  <!-- =====================================================
       STEP 5 — Launch
       ===================================================== -->
  <div id="step-5" class="step-panel">
    <div class="bg-gray-900 border border-gray-800 rounded-2xl p-6">
      <h2 class="text-xl font-semibold text-white mb-1">Step 5 — Launch</h2>
      <p class="text-gray-400 text-sm mb-6">Choose how to start SuperClaw.</p>

      <div id="pm2Status" class="hidden mb-4 p-3 rounded-lg text-sm"></div>

      <!-- Launch cards -->
      <div class="grid gap-4 mb-6">

        <!-- PM2 Card -->
        <div class="launch-card bg-gray-800/60 border border-gray-700 rounded-xl p-5">
          <div class="flex items-start gap-3 mb-3">
            <div class="w-10 h-10 rounded-lg bg-brand-900 border border-brand-700 flex items-center justify-center flex-shrink-0">
              <span class="text-xl">🚀</span>
            </div>
            <div>
              <h3 class="font-semibold text-white">PM2 <span class="text-xs bg-brand-900 text-brand-400 border border-brand-700 px-2 py-0.5 rounded-full ml-1">Recommended</span></h3>
              <p class="text-gray-400 text-sm mt-0.5">Auto-restart on crash, survives reboots, log management.</p>
            </div>
          </div>
          <div class="terminal text-xs mb-3"><?php
$root = PROJECT_ROOT;
echo htmlspecialchars("cd {$root}\npm2 start ecosystem.config.js\npm2 save\npm2 startup");
?></div>
          <button id="btnStartPm2"
            class="w-full bg-brand-600 hover:bg-brand-500 text-white font-semibold py-2.5 px-4 rounded-lg transition-colors flex items-center justify-center gap-2">
            <svg id="pm2Spinner" class="spinner h-4 w-4 hidden" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
              <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
              <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path>
            </svg>
            Start with PM2
          </button>
        </div>

        <!-- Direct Card -->
        <div class="launch-card bg-gray-800/60 border border-gray-700 rounded-xl p-5">
          <div class="flex items-start gap-3 mb-3">
            <div class="w-10 h-10 rounded-lg bg-gray-800 border border-gray-700 flex items-center justify-center flex-shrink-0">
              <span class="text-xl">💻</span>
            </div>
            <div>
              <h3 class="font-semibold text-white">Direct (Terminal)</h3>
              <p class="text-gray-400 text-sm mt-0.5">Run directly in your SSH session. Stops when you disconnect.</p>
            </div>
          </div>
          <div class="terminal text-xs"><?php
echo htmlspecialchars("cd {$root}\nnode dist/index.js");
?></div>
        </div>

        <!-- Admin Panel Card -->
        <div class="launch-card bg-gray-800/60 border border-gray-700 rounded-xl p-5">
          <div class="flex items-start gap-3 mb-3">
            <div class="w-10 h-10 rounded-lg bg-gray-800 border border-gray-700 flex items-center justify-center flex-shrink-0">
              <span class="text-xl">🖥️</span>
            </div>
            <div>
              <h3 class="font-semibold text-white">Web Admin Panel</h3>
              <p class="text-gray-400 text-sm mt-0.5">Access the built-in web interface (if enabled in config).</p>
            </div>
          </div>
          <a id="adminPanelLink" href="#" target="_blank"
            class="block w-full text-center bg-gray-700 hover:bg-gray-600 text-gray-200 font-medium py-2.5 px-4 rounded-lg transition-colors">
            Open Admin Panel (port 3000) →
          </a>
        </div>
      </div>

      <!-- PM2 output -->
      <div id="pm2Output" class="hidden">
        <div class="flex items-center gap-2 mb-2">
          <span class="text-xs text-gray-400">PM2 Output:</span>
        </div>
        <pre id="pm2OutputPre" class="terminal"></pre>
      </div>

      <!-- Security notice -->
      <div class="mt-6 bg-yellow-900/30 border border-yellow-700/50 rounded-xl p-4">
        <p class="text-yellow-300 text-sm">
          <strong>⚠️ Security Reminder:</strong> Delete <code class="bg-yellow-900/50 px-1 rounded">setup/index.php</code> from your server after setup is complete.
        </p>
      </div>
    </div>
  </div>

</div><!-- /max-w-3xl -->
<?php endif; ?>

<!-- =========================================================
     JAVASCRIPT
     ========================================================= -->
<script>
// ---------------------------------------------------------------------------
// Theme toggle
// ---------------------------------------------------------------------------
(function() {
  const saved = localStorage.getItem('sc-theme');
  if (saved === 'light') {
    document.documentElement.classList.remove('dark');
    document.getElementById('iconMoon').classList.add('hidden');
    document.getElementById('iconSun').classList.remove('hidden');
  }
})();

document.getElementById('themeToggle').addEventListener('click', function() {
  const html = document.documentElement;
  const isDark = html.classList.contains('dark');
  if (isDark) {
    html.classList.remove('dark');
    html.classList.add('light');
    localStorage.setItem('sc-theme', 'light');
    document.getElementById('iconMoon').classList.add('hidden');
    document.getElementById('iconSun').classList.remove('hidden');
  } else {
    html.classList.remove('light');
    html.classList.add('dark');
    localStorage.setItem('sc-theme', 'dark');
    document.getElementById('iconMoon').classList.remove('hidden');
    document.getElementById('iconSun').classList.add('hidden');
  }
});

// ---------------------------------------------------------------------------
// Auth page helpers
// ---------------------------------------------------------------------------
function toggleAuthPw() {
  const inp = document.getElementById('authPassword');
  if (!inp) return;
  inp.type = inp.type === 'password' ? 'text' : 'password';
}

// ---------------------------------------------------------------------------
// Wizard state
// ---------------------------------------------------------------------------
<?php if ($isAuthed && !$setupDone): ?>

let currentStep = 1;
const TOTAL_STEPS = 5;

function showStep(n) {
  for (let i = 1; i <= TOTAL_STEPS; i++) {
    const panel = document.getElementById('step-' + i);
    if (panel) panel.classList.toggle('active', i === n);
  }
  currentStep = n;
  updateProgress(n);
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function updateProgress(active) {
  for (let i = 1; i <= TOTAL_STEPS; i++) {
    const dot   = document.getElementById('step-dot-' + i);
    const num   = document.getElementById('step-dot-num-' + i);
    const check = document.getElementById('step-dot-check-' + i);
    const label = document.getElementById('step-label-' + i);
    const line  = document.getElementById('step-line-' + i);

    if (!dot) continue;

    if (i < active) {
      // Completed
      dot.className = 'w-9 h-9 rounded-full flex items-center justify-center text-sm font-bold border-2 transition-all duration-300 bg-brand-600 border-brand-500 text-white';
      if (num) num.classList.add('hidden');
      if (check) check.classList.remove('hidden');
      if (label) label.className = 'text-xs mt-1 text-brand-400 hidden sm:block text-center';
    } else if (i === active) {
      // Active
      dot.className = 'w-9 h-9 rounded-full flex items-center justify-center text-sm font-bold border-2 transition-all duration-300 bg-brand-600 border-brand-500 text-white';
      if (num) num.classList.remove('hidden');
      if (check) check.classList.add('hidden');
      if (label) label.className = 'text-xs mt-1 text-brand-400 hidden sm:block text-center';
    } else {
      // Future
      dot.className = 'w-9 h-9 rounded-full flex items-center justify-center text-sm font-bold border-2 transition-all duration-300 bg-gray-800 border-gray-700 text-gray-500';
      if (num) num.classList.remove('hidden');
      if (check) check.classList.add('hidden');
      if (label) label.className = 'text-xs mt-1 text-gray-600 hidden sm:block text-center';
    }

    if (line) {
      line.className = i < active
        ? 'flex-1 h-0.5 bg-brand-600 mx-1 transition-all duration-500 max-w-[60px]'
        : 'flex-1 h-0.5 bg-gray-800 mx-1 transition-all duration-500 max-w-[60px]';
    }
  }
}

// ---------------------------------------------------------------------------
// Step 1 — System Check
// ---------------------------------------------------------------------------
function statusBadge(ok, text) {
  if (ok === true) {
    return `<span class="inline-flex items-center gap-1 text-green-400"><svg class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7"/></svg>${text}</span>`;
  } else if (ok === false) {
    return `<span class="inline-flex items-center gap-1 text-red-400"><svg class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"/></svg>${text}</span>`;
  } else {
    return `<span class="inline-flex items-center gap-1 text-yellow-400"><svg class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>${text}</span>`;
  }
}

function loadStatus() {
  fetch('?action=status')
    .then(r => r.json())
    .then(data => {
      const nodeOk = data.node && !data.node.includes('Not found') && !data.node.includes('command not found');
      const pnpmOk = data.pnpm && !data.pnpm.includes('Not found') && !data.pnpm.includes('command not found');
      const gitOk  = data.git  && !data.git.includes('Not found')  && !data.git.includes('command not found');

      const rows = [
        ['Node.js',          nodeOk,      data.node],
        ['pnpm',             pnpmOk,      data.pnpm],
        ['Git',              gitOk,       data.git],
        ['.env file',        data.env,    data.env ? 'Found' : 'Not found (will be created)'],
        ['dist/ (built)',    data.dist,   data.dist ? 'Found' : 'Not built yet'],
        ['SuperClaw running',data.running, data.running ? 'Online (PM2)' : 'Not running'],
      ];

      let html = '';
      rows.forEach(([name, ok, detail]) => {
        html += `<tr class="hover:bg-gray-800/30 transition-colors">
          <td class="px-4 py-3 text-gray-300 font-medium">${name}</td>
          <td class="px-4 py-3">${statusBadge(ok, ok ? 'OK' : 'Missing')}</td>
          <td class="px-4 py-3 text-gray-400 text-xs font-mono">${escHtml(detail || '')}</td>
        </tr>`;
      });

      document.getElementById('statusTable').innerHTML = html;

      // Enable start button if Node + pnpm are available
      if (nodeOk && pnpmOk) {
        document.getElementById('btnStartSetup').disabled = false;
      }
    })
    .catch(err => {
      document.getElementById('statusTable').innerHTML =
        `<tr><td colspan="3" class="px-4 py-4 text-red-400 text-sm">Failed to load status: ${escHtml(err.message)}</td></tr>`;
    });
}

function escHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

document.getElementById('btnStartSetup').addEventListener('click', () => showStep(2));
document.getElementById('btnTerminal').addEventListener('click', () => {
  const panel = document.getElementById('terminalPanel');
  panel.classList.toggle('hidden');
});

// Load status on page load
loadStatus();

// ---------------------------------------------------------------------------
// Step 2 — Install
// ---------------------------------------------------------------------------
document.getElementById('btnInstall').addEventListener('click', function() {
  const btn = this;
  btn.disabled = true;
  btn.innerHTML = `<svg class="spinner h-5 w-5" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24"><circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle><path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path></svg> Installing...`;

  const outputWrap = document.getElementById('installOutput');
  const outputPre  = document.getElementById('installOutputPre');
  const spinner    = document.getElementById('installSpinner');
  const label      = document.getElementById('installOutputLabel');

  outputWrap.classList.remove('hidden');
  spinner.classList.remove('hidden');
  label.textContent = 'Running pnpm install...';
  outputPre.textContent = '';

  fetch('?action=install', { method: 'POST' })
    .then(r => r.json())
    .then(data => {
      spinner.classList.add('hidden');
      label.textContent = 'Output:';
      outputPre.textContent = data.output || data.error || '(no output)';
      outputPre.scrollTop = outputPre.scrollHeight;

      const success = !data.error && data.output && !data.output.toLowerCase().includes('err_');
      const statusEl = document.getElementById('installStatus');
      statusEl.classList.remove('hidden');

      if (success) {
        statusEl.className = 'mb-4 p-3 rounded-lg text-sm bg-green-900/40 border border-green-700 text-green-300';
        statusEl.textContent = '✅ Dependencies installed successfully!';
        document.getElementById('installNextWrap').classList.remove('hidden');
      } else if (data.error) {
        statusEl.className = 'mb-4 p-3 rounded-lg text-sm bg-red-900/40 border border-red-700 text-red-300';
        statusEl.textContent = '❌ ' + data.error;
      } else {
        // Show next anyway — pnpm may have warnings but still succeeded
        statusEl.className = 'mb-4 p-3 rounded-lg text-sm bg-yellow-900/40 border border-yellow-700 text-yellow-300';
        statusEl.textContent = '⚠️ Installation completed with warnings. Review output above.';
        document.getElementById('installNextWrap').classList.remove('hidden');
      }

      btn.disabled = false;
      btn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"/></svg> Re-run Install`;
    })
    .catch(err => {
      spinner.classList.add('hidden');
      outputPre.textContent = 'Request failed: ' + err.message;
      btn.disabled = false;
      btn.textContent = 'Retry Install';
    });
});

document.getElementById('btnInstallNext').addEventListener('click', () => showStep(3));

// ---------------------------------------------------------------------------
// Step 3 — Configure
// ---------------------------------------------------------------------------
const providerDefaults = {
  openai:    { model: 'gpt-4o',                      label: 'OpenAI API Key',       hint: 'Get your key from platform.openai.com',    placeholder: 'sk-...' },
  anthropic: { model: 'claude-3-5-sonnet-20241022',  label: 'Anthropic API Key',    hint: 'Get your key from console.anthropic.com',  placeholder: 'sk-ant-...' },
  groq:      { model: 'llama3-70b-8192',             label: 'Groq API Key',         hint: 'Get your key from console.groq.com',       placeholder: 'gsk_...' },
  ollama:    { model: 'llama3.2',                    label: 'Ollama Base URL',      hint: 'Default: http://localhost:11434',           placeholder: 'http://localhost:11434' },
  custom:    { model: 'gpt-4o',                      label: 'Custom API Base URL',  hint: 'e.g. https://openrouter.ai/api/v1',        placeholder: 'https://...' },
};

document.getElementById('aiProvider').addEventListener('change', function() {
  const d = providerDefaults[this.value] || providerDefaults.openai;
  document.getElementById('aiModel').value       = d.model;
  document.getElementById('apiKeyLabel').textContent = d.label;
  document.getElementById('apiKeyHint').textContent  = d.hint;
  document.getElementById('apiKey').placeholder      = d.placeholder;
  document.getElementById('apiKey').type = this.value === 'ollama' ? 'text' : 'password';
});

function toggleApiKey() {
  const inp = document.getElementById('apiKey');
  inp.type = inp.type === 'password' ? 'text' : 'password';
}

function toggleWhatsApp(cb) {
  const wrap  = document.getElementById('waNumberWrap');
  const track = document.getElementById('waToggleTrack');
  const thumb = document.getElementById('waToggleThumb');
  const hidden = document.getElementById('waEnabledInput');

  if (cb.checked) {
    wrap.classList.remove('hidden');
    track.style.backgroundColor = '#14b8a6';
    thumb.style.transform = 'translateX(20px)';
    thumb.style.backgroundColor = '#fff';
    hidden.value = '1';
  } else {
    wrap.classList.add('hidden');
    track.style.backgroundColor = '';
    thumb.style.transform = '';
    thumb.style.backgroundColor = '';
    hidden.value = '0';
  }
}

document.getElementById('configForm').addEventListener('submit', function(e) {
  e.preventDefault();
  const formData = new FormData(this);
  const statusEl = document.getElementById('configStatus');

  statusEl.className = 'mb-4 p-3 rounded-lg text-sm bg-gray-800 border border-gray-700 text-gray-300';
  statusEl.classList.remove('hidden');
  statusEl.textContent = '⏳ Saving configuration...';

  fetch('?action=configure', { method: 'POST', body: formData })
    .then(r => r.json())
    .then(data => {
      if (data.success) {
        statusEl.className = 'mb-4 p-3 rounded-lg text-sm bg-green-900/40 border border-green-700 text-green-300';
        statusEl.textContent = '✅ ' + data.message;
        document.getElementById('configNextWrap').classList.remove('hidden');
      } else {
        statusEl.className = 'mb-4 p-3 rounded-lg text-sm bg-red-900/40 border border-red-700 text-red-300';
        statusEl.textContent = '❌ ' + (data.error || 'Unknown error');
      }
    })
    .catch(err => {
      statusEl.className = 'mb-4 p-3 rounded-lg text-sm bg-red-900/40 border border-red-700 text-red-300';
      statusEl.textContent = '❌ Request failed: ' + err.message;
    });
});

document.getElementById('btnConfigNext').addEventListener('click', () => showStep(4));

// ---------------------------------------------------------------------------
// Step 4 — Build
// ---------------------------------------------------------------------------
document.getElementById('btnBuild').addEventListener('click', function() {
  const btn = this;
  btn.disabled = true;
  btn.innerHTML = `<svg class="spinner h-5 w-5" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24"><circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle><path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path></svg> Building...`;

  const outputWrap = document.getElementById('buildOutput');
  const outputPre  = document.getElementById('buildOutputPre');
  const spinner    = document.getElementById('buildSpinner');
  const label      = document.getElementById('buildOutputLabel');

  outputWrap.classList.remove('hidden');
  spinner.classList.remove('hidden');
  label.textContent = 'Running pnpm build...';
  outputPre.textContent = '';

  fetch('?action=build', { method: 'POST' })
    .then(r => r.json())
    .then(data => {
      spinner.classList.add('hidden');
      label.textContent = 'Output:';
      outputPre.textContent = data.output || data.error || '(no output)';
      outputPre.scrollTop = outputPre.scrollHeight;

      const statusEl = document.getElementById('buildStatus');
      statusEl.classList.remove('hidden');

      const hasError = data.error || (data.output && data.output.toLowerCase().includes('error ts'));
      if (!hasError) {
        statusEl.className = 'mb-4 p-3 rounded-lg text-sm bg-green-900/40 border border-green-700 text-green-300';
        statusEl.textContent = '✅ Build completed successfully!';
        document.getElementById('buildNextWrap').classList.remove('hidden');
      } else {
        statusEl.className = 'mb-4 p-3 rounded-lg text-sm bg-red-900/40 border border-red-700 text-red-300';
        statusEl.textContent = '❌ Build failed. Check output above for TypeScript errors.';
      }

      btn.disabled = false;
      btn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"/><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"/></svg> Re-run Build`;
    })
    .catch(err => {
      spinner.classList.add('hidden');
      outputPre.textContent = 'Request failed: ' + err.message;
      btn.disabled = false;
      btn.textContent = 'Retry Build';
    });
});

document.getElementById('btnBuildNext').addEventListener('click', () => {
  // Set admin panel link based on current host
  const host = window.location.hostname;
  document.getElementById('adminPanelLink').href = 'http://' + host + ':3000';
  showStep(5);
});

// ---------------------------------------------------------------------------
// Step 5 — Launch
// ---------------------------------------------------------------------------
document.getElementById('btnStartPm2').addEventListener('click', function() {
  const btn = this;
  btn.disabled = true;
  const spinner = document.getElementById('pm2Spinner');
  spinner.classList.remove('hidden');
  btn.querySelector('span') && (btn.querySelector('span').textContent = ' Starting...');

  const outputWrap = document.getElementById('pm2Output');
  const outputPre  = document.getElementById('pm2OutputPre');
  const statusEl   = document.getElementById('pm2Status');

  outputWrap.classList.remove('hidden');
  outputPre.textContent = '';
  statusEl.classList.add('hidden');

  fetch('?action=start_pm2', { method: 'POST' })
    .then(r => r.json())
    .then(data => {
      spinner.classList.add('hidden');
      outputPre.textContent = data.output || data.error || '(no output)';
      outputPre.scrollTop = outputPre.scrollHeight;

      statusEl.classList.remove('hidden');
      if (data.error) {
        statusEl.className = 'mb-4 p-3 rounded-lg text-sm bg-red-900/40 border border-red-700 text-red-300';
        statusEl.textContent = '❌ ' + data.error;
      } else {
        statusEl.className = 'mb-4 p-3 rounded-lg text-sm bg-green-900/40 border border-green-700 text-green-300';
        statusEl.textContent = '✅ SuperClaw started with PM2! Check your Telegram bot.';
      }

      btn.disabled = false;
      btn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"/></svg> Restart PM2`;
    })
    .catch(err => {
      spinner.classList.add('hidden');
      outputPre.textContent = 'Request failed: ' + err.message;
      btn.disabled = false;
      btn.textContent = 'Retry';
    });
});

<?php endif; ?>
</script>

</body>
</html>
