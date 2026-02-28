export type Platform = 'telegram' | 'whatsapp';

export interface NormalizedMessage {
  platform: Platform;
  userId: string;
  chatId: string;
  text: string;
  timestamp: Date;
  messageId?: string;
  replyToMessageId?: string;
}

export interface NormalizedResponse {
  platform: Platform;
  chatId: string;
  text: string;
  parseMode?: 'Markdown' | 'HTML' | 'plain';
  replyToMessageId?: string;
  confirmationId?: string; // for destructive op confirmations
}

export interface ConfirmationRequest {
  id: string;
  platform: Platform;
  chatId: string;
  userId: string;
  command: string;
  expiresAt: Date;
  resolve: (confirmed: boolean) => void;
}

export interface ToolResult {
  success: boolean;
  data?: any;
  error?: string;
}

export interface Tool {
  name: string;
  description: string;
  parameters: Record<string, any>; // JSON Schema
  execute(params: any): Promise<ToolResult>;
}

export interface ConversationMessage {
  role: 'user' | 'assistant' | 'tool';
  content: string;
  toolCallId?: string;
  toolName?: string;
  timestamp: Date;
}

/** A single fallback AI provider entry used by FunctionCaller failover logic. */
export interface FallbackModel {
  provider: 'openai' | 'anthropic' | 'groq' | 'ollama' | 'custom';
  model: string;
  apiKey?: string;
  baseUrl?: string;
}

export interface AgentConfig {
  agentName: string;
  aiProvider: 'openai' | 'anthropic' | 'groq' | 'ollama' | 'custom';
  aiModel: string;
  openaiApiKey?: string;
  anthropicApiKey?: string;
  groqApiKey?: string;
  ollamaBaseUrl?: string;
  customAiBaseUrl?: string;
  customAiModel?: string;
  customAiApiKey?: string;
  /** Optional — only required when Telegram platform is enabled */
  telegramBotToken: string;
  /** Optional — only required when Telegram platform is enabled */
  adminTelegramId: string;
  whatsappSessionName: string;
  /** Optional — only required when WhatsApp platform is enabled */
  adminWhatsappNumber: string;
  vpsHostname: string;
  logLevel: string;
  dbPath: string;
  serpApiKey?: string;
  maxMessagesPerMinute: number;
  maxAiCallsPerMinute: number;
  maxConcurrentTools: number;
  maxConcurrentAgents: number;
  /** Ordered list of fallback AI providers tried when the primary fails */
  fallbackModels?: FallbackModel[];
  /** Max retry attempts for transient errors (default: 3) */
  aiMaxRetries: number;
  /** Base delay in ms for exponential backoff (default: 1000) */
  aiRetryDelayMs: number;
}
