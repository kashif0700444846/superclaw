import dotenv from 'dotenv';
import path from 'path';
import { AgentConfig } from './gateway/types';

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

function validateProvider(provider: string): 'openai' | 'anthropic' | 'groq' | 'ollama' {
  const valid = ['openai', 'anthropic', 'groq', 'ollama'];
  if (!valid.includes(provider)) {
    throw new Error(`Invalid AI_PROVIDER: ${provider}. Must be one of: ${valid.join(', ')}`);
  }
  return provider as 'openai' | 'anthropic' | 'groq' | 'ollama';
}

const provider = validateProvider(optionalEnv('AI_PROVIDER', 'openai'));

export const config: AgentConfig = {
  agentName: optionalEnv('AGENT_NAME', 'SuperClaw'),
  aiProvider: provider,
  aiModel: optionalEnv('AI_MODEL', 'gpt-4o'),
  openaiApiKey: optionalEnv('OPENAI_API_KEY'),
  anthropicApiKey: optionalEnv('ANTHROPIC_API_KEY'),
  groqApiKey: optionalEnv('GROQ_API_KEY'),
  ollamaBaseUrl: optionalEnv('OLLAMA_BASE_URL', 'http://localhost:11434'),
  telegramBotToken: optionalEnv('TELEGRAM_BOT_TOKEN', 'DISABLED'),
  adminTelegramId: optionalEnv('ADMIN_TELEGRAM_ID', '0'),
  whatsappSessionName: optionalEnv('WHATSAPP_SESSION_NAME', 'superclaw'),
  adminWhatsappNumber: optionalEnv('ADMIN_WHATSAPP_NUMBER', 'DISABLED'),
  vpsHostname: optionalEnv('VPS_HOSTNAME', 'localhost'),
  logLevel: optionalEnv('LOG_LEVEL', 'info'),
  dbPath: optionalEnv('DB_PATH', './data/superclaw.db'),
  serpApiKey: optionalEnv('SERPAPI_KEY'),
  maxMessagesPerMinute: parseInt(optionalEnv('MAX_MESSAGES_PER_MINUTE', '30')),
  maxAiCallsPerMinute: parseInt(optionalEnv('MAX_AI_CALLS_PER_MINUTE', '10')),
  maxConcurrentTools: parseInt(optionalEnv('MAX_CONCURRENT_TOOLS', '5')),
};

export default config;
