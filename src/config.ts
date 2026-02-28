import dotenv from 'dotenv';
import path from 'path';
import { AgentConfig, FallbackModel } from './gateway/types';

dotenv.config({ path: path.resolve(process.cwd(), '.env') });

function requireEnv(key: string): string {
  const value = process.env[key];
  if (!value) {
    throw new Error(`Missing required environment variable: ${key}`);
  }
  return value;
}

function optionalEnv(key: string, defaultValue: string = ''): string {
  return process.env[key] || defaultValue;
}

function validateProvider(provider: string): 'openai' | 'anthropic' | 'groq' | 'ollama' | 'custom' {
  const valid = ['openai', 'anthropic', 'groq', 'ollama', 'custom'];
  if (!valid.includes(provider)) {
    throw new Error(`Invalid AI_PROVIDER: ${provider}. Must be one of: ${valid.join(', ')}`);
  }
  return provider as 'openai' | 'anthropic' | 'groq' | 'ollama' | 'custom';
}

/**
 * Build the fallback model list from FALLBACK_AI_PROVIDER and FALLBACK_AI_MODEL
 * env vars (comma-separated, positionally matched).
 *
 * Example:
 *   FALLBACK_AI_PROVIDER=groq,ollama
 *   FALLBACK_AI_MODEL=llama-3.1-70b-versatile,llama3
 */
function buildFallbackModels(): FallbackModel[] {
  const providers = optionalEnv('FALLBACK_AI_PROVIDER');
  const models = optionalEnv('FALLBACK_AI_MODEL');

  if (!providers || !models) return [];

  const providerList = providers.split(',').map((s) => s.trim());
  const modelList = models.split(',').map((s) => s.trim());

  const fallbacks: FallbackModel[] = [];
  const count = Math.min(providerList.length, modelList.length);

  for (let i = 0; i < count; i++) {
    const p = providerList[i];
    const valid = ['openai', 'anthropic', 'groq', 'ollama', 'custom'];
    if (!valid.includes(p)) continue; // skip invalid providers silently

    fallbacks.push({
      provider: p as FallbackModel['provider'],
      model: modelList[i],
    });
  }

  return fallbacks;
}

const provider = validateProvider(optionalEnv('AI_PROVIDER', 'openai'));

// Parse comma-separated Telegram admin IDs — robust against CRLF line endings,
// extra whitespace, empty entries, and non-numeric values.
const adminTelegramIdRaw = (process.env.ADMIN_TELEGRAM_ID || '').replace(/\r/g, '').trim();
const adminTelegramIds: number[] = adminTelegramIdRaw
  .split(',')
  .map((id) => id.trim())
  .filter((id) => id.length > 0)
  .map((id) => parseInt(id, 10))
  .filter((id) => !isNaN(id) && id > 0);

// Log parsed IDs at startup so auth issues are immediately visible in logs
console.log(`[Config] Parsed ADMIN_TELEGRAM_ID="${adminTelegramIdRaw}" → adminTelegramIds=[${adminTelegramIds.join(', ')}]`);

const adminTelegramId = adminTelegramIds.length > 0 ? String(adminTelegramIds[0]) : ''; // first ID for backward compat

// Parse comma-separated WhatsApp admin numbers — robust against CRLF line endings.
// ADMIN_WHATSAPP_NUMBERS (plural) takes precedence; falls back to ADMIN_WHATSAPP_NUMBER (singular)
const adminWhatsappNumbers = ((process.env.ADMIN_WHATSAPP_NUMBERS || process.env.ADMIN_WHATSAPP_NUMBER || 'DISABLED')
  .replace(/\r/g, ''))
  .split(',')
  .map((n) => n.trim())
  .filter((n) => n.length > 0);
const adminWhatsappNumber = adminWhatsappNumbers[0] || 'DISABLED'; // first number for backward compat

console.log(`[Config] Parsed adminWhatsappNumbers=[${adminWhatsappNumbers.join(', ')}]`);

export const config: AgentConfig = {
  agentName: optionalEnv('AGENT_NAME', 'SuperClaw'),
  aiProvider: provider,
  aiModel: optionalEnv('AI_MODEL', 'gpt-4o'),
  openaiApiKey: optionalEnv('OPENAI_API_KEY'),
  anthropicApiKey: optionalEnv('ANTHROPIC_API_KEY'),
  groqApiKey: optionalEnv('GROQ_API_KEY'),
  ollamaBaseUrl: optionalEnv('OLLAMA_BASE_URL', 'http://localhost:11434'),
  customAiBaseUrl: optionalEnv('CUSTOM_AI_BASE_URL'),
  customAiModel: optionalEnv('CUSTOM_AI_MODEL'),
  customAiApiKey: optionalEnv('CUSTOM_AI_API_KEY'),
  telegramBotToken: optionalEnv('TELEGRAM_BOT_TOKEN', 'DISABLED'),
  adminTelegramId: String(adminTelegramId),   // backward compat — first ID as string
  adminTelegramIds,                            // all authorized Telegram admin IDs
  whatsappSessionName: optionalEnv('WHATSAPP_SESSION_NAME', 'superclaw'),
  adminWhatsappNumber,                         // backward compat — first number
  adminWhatsappNumbers,                        // all authorized WhatsApp admin numbers
  vpsHostname: optionalEnv('VPS_HOSTNAME', 'localhost'),
  logLevel: optionalEnv('LOG_LEVEL', 'info'),
  dbPath: optionalEnv('DB_PATH', './data/superclaw.db'),
  serpApiKey: optionalEnv('SERPAPI_KEY'),
  maxMessagesPerMinute: parseInt(optionalEnv('MAX_MESSAGES_PER_MINUTE', '30')),
  maxAiCallsPerMinute: parseInt(optionalEnv('MAX_AI_CALLS_PER_MINUTE', '10')),
  maxConcurrentTools: parseInt(optionalEnv('MAX_CONCURRENT_TOOLS', '5')),
  maxConcurrentAgents: parseInt(optionalEnv('MAX_CONCURRENT_AGENTS', '5')),
  // Failover / retry configuration
  fallbackModels: buildFallbackModels(),
  aiMaxRetries: parseInt(optionalEnv('AI_MAX_RETRIES', '3')),
  aiRetryDelayMs: parseInt(optionalEnv('AI_RETRY_DELAY_MS', '1000')),
};

export default config;
