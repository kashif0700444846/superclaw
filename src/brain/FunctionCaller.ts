import OpenAI from 'openai';
import Anthropic from '@anthropic-ai/sdk';
import axios from 'axios';
import { ConversationMessage, FallbackModel, Platform } from '../gateway/types';
import { toolRegistry } from './ToolRegistry';
import { config } from '../config';
import { logger } from '../logger';

export interface ToolCallRecord {
  name: string;
  args: string; // JSON.stringify of args
  result: string; // JSON.stringify of result
}

export interface FunctionCallerResult {
  response: string;
  toolsUsed: string[];
  /** Count of tools called this turn (used by Brain for hallucination enforcement) */
  toolsCalledCount: number;
  /** Full history of tool calls made this turn */
  toolCallHistory: ToolCallRecord[];
}

const MAX_ITERATIONS = 50;

/**
 * Returns the maximum number of iterations allowed for a given user message.
 * Complex multi-step tasks get the full 50-iteration budget; simple queries
 * get a lower limit of 20 to avoid unnecessary API calls.
 */
function getMaxIterations(userMessage: string): number {
  const complexKeywords = [
    'install', 'setup', 'configure', 'build', 'deploy', 'create', 'write',
    'implement', 'fix', 'update', 'migrate', 'refactor', 'analyze', 'scan',
    'download', 'compile', 'test', 'run', 'execute', 'start', 'stop',
    'delete', 'remove', 'move', 'copy', 'rename', 'generate', 'enable',
    'disable', 'restart', 'upgrade', 'clone', 'init', 'push', 'pull',
  ];
  const isComplex = complexKeywords.some((kw) =>
    new RegExp(`\\b${kw}\\b`, 'i').test(userMessage)
  );
  return isComplex ? MAX_ITERATIONS : 20;
}

// ---------------------------------------------------------------------------
// Context-window overflow prevention
// ---------------------------------------------------------------------------

const MAX_TOOL_RESULT_CHARS = 50_000; // ~12,500 tokens

/**
 * Sanitize a tool result before adding it to the messages array.
 * Detects base64 blobs and oversized payloads and replaces them with a
 * human-readable placeholder so the context window is never blown out.
 */
function sanitizeToolResult(result: unknown, toolName: string): string {
  const str = typeof result === 'string' ? result : JSON.stringify(result);

  // Special handling for base64 data (e.g. file_read with encoding:"base64")
  if (str.includes('base64') || toolName === 'file_read') {
    const base64Pattern = /[A-Za-z0-9+/]{1000,}={0,2}/;
    if (base64Pattern.test(str)) {
      const sizeKB = Math.round(str.length / 1024);
      return `[Binary/base64 data truncated: ${sizeKB}KB. The file was read successfully but the raw binary content cannot be stored in conversation history. Use a different approach to process this file, such as saving it to a specific path and referencing it by path.]`;
    }
  }

  if (str.length > MAX_TOOL_RESULT_CHARS) {
    const truncated = str.substring(0, MAX_TOOL_RESULT_CHARS);
    const remaining = str.length - MAX_TOOL_RESULT_CHARS;
    return truncated + `\n\n[... TRUNCATED: ${remaining} more characters omitted to fit context window ...]`;
  }

  return str;
}

const MAX_CONTEXT_TOKENS = 150_000; // Leave ~50k headroom for response + tools

function estimateTokens(messages: unknown[]): number {
  return Math.ceil(JSON.stringify(messages).length / 4);
}

/**
 * Trim the messages array so the estimated token count stays under
 * MAX_CONTEXT_TOKENS (accounting for the system prompt separately).
 * Always keeps at least the last 2 messages so the AI has context.
 */
function trimMessagesToFitContext(messages: unknown[], systemPrompt: string): unknown[] {
  const systemTokens = Math.ceil(systemPrompt.length / 4);
  const availableTokens = MAX_CONTEXT_TOKENS - systemTokens;

  let trimmed = [...messages];
  while (estimateTokens(trimmed) > availableTokens && trimmed.length > 2) {
    trimmed.splice(0, 1);
  }

  return trimmed;
}

// Inline types for the old Anthropic SDK (0.17.x) which lacks tool-use support
interface AnthropicMessageParam {
  role: 'user' | 'assistant';
  content: string;
}

// ---------------------------------------------------------------------------
// Retry / failover helpers
// ---------------------------------------------------------------------------

/** Returns true if the error is a rate-limit or server-side transient error. */
function isRetryableError(err: unknown): boolean {
  const status = (err as { status?: number })?.status ?? 0;
  const msg = err instanceof Error ? err.message : String(err);
  return (
    status === 429 ||
    status === 500 ||
    status === 503 ||
    msg.includes('429') ||
    msg.includes('rate limit') ||
    msg.includes('Rate limit') ||
    msg.includes('overloaded') ||
    msg.includes('server error')
  );
}

/** Sleep for `ms` milliseconds. */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Build an OpenAI-compatible client for a given fallback model entry.
 * Returns null if the provider cannot be initialised (missing credentials).
 */
function buildFallbackClient(fb: FallbackModel): OpenAI | null {
  const browserHeaders = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
    'Accept': 'application/json',
    'Accept-Language': 'en-US,en;q=0.9',
  };

  switch (fb.provider) {
    case 'openai':
      if (!fb.apiKey && !config.openaiApiKey) return null;
      return new OpenAI({
        apiKey: fb.apiKey || config.openaiApiKey || '',
        defaultHeaders: browserHeaders,
      });
    case 'groq':
      if (!fb.apiKey && !config.groqApiKey) return null;
      return new OpenAI({
        apiKey: fb.apiKey || config.groqApiKey || '',
        baseURL: 'https://api.groq.com/openai/v1',
        defaultHeaders: browserHeaders,
      });
    case 'custom':
      return new OpenAI({
        apiKey: fb.apiKey || config.customAiApiKey || 'none',
        baseURL: fb.baseUrl || config.customAiBaseUrl || '',
        defaultHeaders: browserHeaders,
      });
    case 'ollama':
      return new OpenAI({
        apiKey: 'ollama',
        baseURL: fb.baseUrl || config.ollamaBaseUrl || 'http://localhost:11434/v1',
        defaultHeaders: browserHeaders,
      });
    default:
      return null;
  }
}

/**
 * Execute `fn` with exponential-backoff retries, then try each fallback model
 * in order if the primary keeps failing with retryable errors.
 */
async function withRetryAndFailover<T>(
  primaryCall: () => Promise<T>,
  fallbackCall: ((fb: FallbackModel, client: OpenAI) => Promise<T>) | null,
  fallbacks: FallbackModel[],
  maxRetries: number,
  baseDelayMs: number,
): Promise<T> {
  let lastError: unknown;

  // --- Primary provider with retries ---
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await primaryCall();
    } catch (err: unknown) {
      lastError = err;
      if (!isRetryableError(err) || attempt === maxRetries) break;
      const delay = baseDelayMs * Math.pow(2, attempt);
      logger.warn(`AI call failed (attempt ${attempt + 1}/${maxRetries + 1}), retrying in ${delay}ms`, {
        error: err instanceof Error ? err.message : String(err),
      });
      await sleep(delay);
    }
  }

  // --- Fallback providers (one attempt each, no retry) ---
  if (fallbackCall && fallbacks.length > 0) {
    for (const fb of fallbacks) {
      const client = buildFallbackClient(fb);
      if (!client) {
        logger.warn(`Skipping fallback provider "${fb.provider}" — could not build client (missing credentials?)`);
        continue;
      }
      try {
        logger.warn(`Trying fallback model: ${fb.provider}/${fb.model}`);
        return await fallbackCall(fb, client);
      } catch (err: unknown) {
        lastError = err;
        logger.warn(`Fallback ${fb.provider}/${fb.model} also failed`, {
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
  }

  throw lastError;
}

export class FunctionCaller {
  private openaiClient: OpenAI | null = null;
  private anthropicClient: Anthropic | null = null;
  private aiCallCount: number = 0;
  private aiCallResetTime: number = Date.now();

  constructor() {
    const browserHeaders = {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
      'Accept': 'application/json',
      'Accept-Language': 'en-US,en;q=0.9',
    };

    if (config.aiProvider === 'openai' && config.openaiApiKey) {
      this.openaiClient = new OpenAI({
        apiKey: config.openaiApiKey,
        defaultHeaders: browserHeaders,
      });
    } else if (config.aiProvider === 'groq' && config.groqApiKey) {
      this.openaiClient = new OpenAI({
        apiKey: config.groqApiKey,
        baseURL: 'https://api.groq.com/openai/v1',
        defaultHeaders: browserHeaders,
      });
    } else if (config.aiProvider === 'anthropic' && config.anthropicApiKey) {
      this.anthropicClient = new Anthropic({ apiKey: config.anthropicApiKey });
    } else if (config.aiProvider === 'custom' && config.customAiBaseUrl) {
      this.openaiClient = new OpenAI({
        apiKey: config.customAiApiKey || 'none',
        baseURL: config.customAiBaseUrl,
        defaultHeaders: browserHeaders,
      });
    }
  }

  private checkRateLimit(): boolean {
    const now = Date.now();
    if (now - this.aiCallResetTime > 60000) {
      this.aiCallCount = 0;
      this.aiCallResetTime = now;
    }
    if (this.aiCallCount >= config.maxAiCallsPerMinute) {
      return false;
    }
    this.aiCallCount++;
    return true;
  }

  async run(
    systemPrompt: string,
    history: ConversationMessage[],
    userMessage: string,
    platform: Platform,
    chatId: string,
    userId: string
  ): Promise<FunctionCallerResult> {
    if (!this.checkRateLimit()) {
      return {
        response: '⚠️ AI rate limit reached. Please wait a moment before sending more messages.',
        toolsUsed: [],
        toolsCalledCount: 0,
        toolCallHistory: [],
      };
    }

    const toolsUsed: string[] = [];
    const toolCallHistory: ToolCallRecord[] = [];

    if (config.aiProvider === 'openai' || config.aiProvider === 'groq') {
      return this.runOpenAiLoop(
        systemPrompt,
        history,
        userMessage,
        platform,
        chatId,
        userId,
        toolsUsed,
        toolCallHistory,
        getMaxIterations(userMessage)
      );
    } else if (config.aiProvider === 'anthropic') {
      return this.runAnthropicLoop(
        systemPrompt,
        history,
        userMessage,
        toolsUsed,
        toolCallHistory,
        getMaxIterations(userMessage)
      );
    } else if (config.aiProvider === 'ollama') {
      return this.runOllamaLoop(systemPrompt, history, userMessage, toolsUsed, toolCallHistory);
    } else if (config.aiProvider === 'custom') {
      return this.runCustomLoop(
        systemPrompt,
        history,
        userMessage,
        platform,
        chatId,
        userId,
        toolsUsed,
        toolCallHistory,
        getMaxIterations(userMessage)
      );
    }

    return {
      response: 'No AI provider configured.',
      toolsUsed: [],
      toolsCalledCount: 0,
      toolCallHistory: [],
    };
  }

  /**
   * Check for tool call loops: if the last N calls are identical (same tool + same args),
   * return a loop-detected message. Returns null if no loop detected.
   */
  private detectToolLoop(history: ToolCallRecord[], repeatThreshold = 3): string | null {
    if (history.length < repeatThreshold) return null;
    const last = history.slice(-repeatThreshold);
    const first = last[0];
    const allSame = last.every((r) => r.name === first.name && r.args === first.args);
    if (allSame) {
      return `Tool loop detected: "${first.name}" was called ${repeatThreshold} times in a row with identical arguments. Stopping to prevent infinite loop.`;
    }
    return null;
  }

  private async runOpenAiLoop(
    systemPrompt: string,
    history: ConversationMessage[],
    userMessage: string,
    platform: Platform,
    chatId: string,
    userId: string,
    toolsUsed: string[],
    toolCallHistory: ToolCallRecord[],
    maxIterations: number
  ): Promise<FunctionCallerResult> {
    if (!this.openaiClient) {
      return {
        response: 'OpenAI/Groq client not initialized.',
        toolsUsed: [],
        toolsCalledCount: 0,
        toolCallHistory: [],
      };
    }

    let messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
      ...history.map((m): OpenAI.Chat.ChatCompletionMessageParam => {
        if (m.role === 'tool') {
          return {
            role: 'tool',
            tool_call_id: m.toolCallId || 'unknown',
            content: m.content,
          };
        }
        return { role: m.role as 'user' | 'assistant', content: m.content };
      }),
      { role: 'user', content: userMessage },
    ];

    const tools = toolRegistry.toOpenAiFunctions();
    const fallbacks = config.fallbackModels ?? [];
    const maxRetries = config.aiMaxRetries;
    const baseDelay = config.aiRetryDelayMs;

    for (let i = 0; i < maxIterations; i++) {
      logger.info(`FunctionCaller OpenAI iteration ${i + 1}/${maxIterations}`);

      // Trim messages to fit context window before each API call
      const trimmedMessages = trimMessagesToFitContext(messages, systemPrompt) as OpenAI.Chat.ChatCompletionMessageParam[];
      if (trimmedMessages.length < messages.length) {
        logger.warn(`FunctionCaller OpenAI: context trimmed — removed ${messages.length - trimmedMessages.length} messages to fit token limit`);
        messages = trimmedMessages;
      }

      const primaryClient = this.openaiClient;
      const primaryModel = config.aiModel;

      const response = await withRetryAndFailover(
        () => primaryClient.chat.completions.create({
          model: primaryModel,
          messages: [{ role: 'system', content: systemPrompt }, ...messages],
          tools,
          tool_choice: 'auto',
          max_tokens: 4096,
        }),
        (fb, fbClient) => fbClient.chat.completions.create({
          model: fb.model,
          messages: [{ role: 'system', content: systemPrompt }, ...messages],
          tools,
          tool_choice: 'auto',
          max_tokens: 4096,
        }),
        fallbacks,
        maxRetries,
        baseDelay,
      );

      const choice = response.choices[0];
      if (!choice) break;

      const assistantMessage = choice.message;
      messages.push(assistantMessage as OpenAI.Chat.ChatCompletionMessageParam);

      if (!assistantMessage.tool_calls || assistantMessage.tool_calls.length === 0) {
        // AI returned text without calling any tools — return as-is
        // Brain.ts will handle hallucination enforcement
        const responseText = assistantMessage.content || 'Task completed.';
        return {
          response: responseText,
          toolsUsed,
          toolsCalledCount: toolsUsed.length,
          toolCallHistory,
        };
      }

      for (const toolCall of assistantMessage.tool_calls) {
        const toolName = toolCall.function.name;
        const toolParams = JSON.parse(toolCall.function.arguments || '{}');

        if (toolName === 'shell_execute') {
          toolParams.platform = platform;
          toolParams.chatId = chatId;
          toolParams.userId = userId;
        }

        logger.info(`FunctionCaller: executing tool "${toolName}"`, { params: toolParams });
        toolsUsed.push(toolName);

        const tool = toolRegistry.getTool(toolName);
        let toolResult: any;

        if (!tool) {
          toolResult = { success: false, error: `Tool not found: ${toolName}` };
        } else {
          toolResult = await tool.execute(toolParams);
        }

        const record: ToolCallRecord = {
          name: toolName,
          args: JSON.stringify(toolParams),
          result: JSON.stringify(toolResult),
        };
        toolCallHistory.push(record);

        // Check for tool loop after recording
        const loopMessage = this.detectToolLoop(toolCallHistory);
        if (loopMessage) {
          logger.warn(`FunctionCaller: ${loopMessage}`);
          return {
            response: `⚠️ ${loopMessage}`,
            toolsUsed,
            toolsCalledCount: toolsUsed.length,
            toolCallHistory,
          };
        }

        messages.push({
          role: 'tool',
          tool_call_id: toolCall.id,
          content: sanitizeToolResult(toolResult, toolName),
        });
      }
    }

    const partialSummary =
      toolsUsed.length > 0
        ? `Tools used so far: ${[...new Set(toolsUsed)].join(', ')}.`
        : 'No tools were called.';
    logger.warn(`FunctionCaller OpenAI: hard iteration cap (${maxIterations}) reached`, {
      toolsUsed,
      toolCallCount: toolCallHistory.length,
    });
    return {
      response:
        `⚠️ Task reached the iteration limit (${maxIterations} steps). The agent stopped to prevent infinite loops. ` +
        `Here is what was completed so far: ${partialSummary}`,
      toolsUsed,
      toolsCalledCount: toolsUsed.length,
      toolCallHistory,
    };
  }

  /**
   * Anthropic SDK v0.17.x does not support native tool/function calling.
   * We use a text-based ReAct-style loop: inject tool descriptions into the
   * system prompt and parse the model's text output for tool invocations.
   */
  private async runAnthropicLoop(
    systemPrompt: string,
    history: ConversationMessage[],
    userMessage: string,
    toolsUsed: string[],
    toolCallHistory: ToolCallRecord[],
    maxIterations: number = MAX_ITERATIONS
  ): Promise<FunctionCallerResult> {
    if (!this.anthropicClient) {
      return {
        response: 'Anthropic client not initialized.',
        toolsUsed: [],
        toolsCalledCount: 0,
        toolCallHistory: [],
      };
    }

    const toolDescriptions = toolRegistry.toDescriptionList();
    const toolNames = toolRegistry.getToolNames().join(', ');

    const reactSystemPrompt =
      `${systemPrompt}\n\n` +
      `## Tool Invocation Format\n` +
      `To use a tool, output EXACTLY this JSON block (nothing before or after on those lines):\n` +
      `\`\`\`tool\n{"tool":"<tool_name>","params":{...}}\n\`\`\`\n` +
      `After the tool result is shown, continue reasoning and either call another tool or give your final answer.\n` +
      `Available tool names: ${toolNames}\n\n` +
      `Tool descriptions:\n${toolDescriptions}`;

    const conversationHistory: AnthropicMessageParam[] = history
      .filter((m) => m.role === 'user' || m.role === 'assistant')
      .map((m) => ({ role: m.role as 'user' | 'assistant', content: m.content }));

    conversationHistory.push({ role: 'user', content: userMessage });

    const fallbacks = config.fallbackModels ?? [];
    const maxRetries = config.aiMaxRetries;
    const baseDelay = config.aiRetryDelayMs;
    const anthropicClient = this.anthropicClient;

    for (let i = 0; i < maxIterations; i++) {
      logger.debug(`FunctionCaller Anthropic iteration ${i + 1}`);

      const response: { content: any } = await withRetryAndFailover(
        () => (anthropicClient.messages as any).create({
          model: config.aiModel,
          max_tokens: 4096,
          system: reactSystemPrompt,
          messages: conversationHistory,
        }) as Promise<{ content: any }>,
        (fb, fbClient) => {
          if (fb.provider !== 'anthropic') {
            return fbClient.chat.completions.create({
              model: fb.model,
              messages: [
                { role: 'system', content: reactSystemPrompt },
                ...conversationHistory.map((m) => ({
                  role: m.role as 'user' | 'assistant',
                  content: m.content,
                })),
              ],
              max_tokens: 4096,
            }).then((r): { content: any } => ({
              content: [{ type: 'text', text: r.choices[0]?.message?.content ?? '' }],
            }));
          }
          return (anthropicClient.messages as any).create({
            model: fb.model,
            max_tokens: 4096,
            system: reactSystemPrompt,
            messages: conversationHistory,
          }) as Promise<{ content: any }>;
        },
        fallbacks,
        maxRetries,
        baseDelay,
      );

      const assistantText: string =
        Array.isArray(response.content)
          ? response.content
              .filter((b: any) => b.type === 'text')
              .map((b: any) => b.text)
              .join('\n')
          : String(response.content || '');

      // Check for tool invocation block
      const toolMatch = assistantText.match(/```tool\s*\n([\s\S]*?)\n```/);

      if (!toolMatch) {
        // No tool call — final answer; Brain.ts handles hallucination enforcement
        const responseText = assistantText.trim() || 'Task completed.';
        return {
          response: responseText,
          toolsUsed,
          toolsCalledCount: toolsUsed.length,
          toolCallHistory,
        };
      }

      // Parse tool call
      let toolName = '';
      let toolParams: any = {};
      try {
        const parsed = JSON.parse(toolMatch[1].trim());
        toolName = parsed.tool || '';
        toolParams = parsed.params || {};
      } catch {
        return {
          response: `Failed to parse tool invocation: ${toolMatch[1]}`,
          toolsUsed,
          toolsCalledCount: toolsUsed.length,
          toolCallHistory,
        };
      }

      logger.info(`Executing tool (Anthropic): ${toolName}`);
      toolsUsed.push(toolName);

      const tool = toolRegistry.getTool(toolName);
      let toolResult: any;

      if (!tool) {
        toolResult = { success: false, error: `Tool not found: ${toolName}` };
      } else {
        toolResult = await tool.execute(toolParams);
      }

      const record: ToolCallRecord = {
        name: toolName,
        args: JSON.stringify(toolParams),
        result: JSON.stringify(toolResult),
      };
      toolCallHistory.push(record);

      // Check for tool loop
      const loopMessage = this.detectToolLoop(toolCallHistory);
      if (loopMessage) {
        logger.warn(`FunctionCaller (anthropic): ${loopMessage}`);
        return {
          response: `⚠️ ${loopMessage}`,
          toolsUsed,
          toolsCalledCount: toolsUsed.length,
          toolCallHistory,
        };
      }

      const toolResultStr = sanitizeToolResult(toolResult, toolName);

      // Append assistant turn and tool result as user turn
      conversationHistory.push({ role: 'assistant', content: assistantText });
      conversationHistory.push({
        role: 'user',
        content: `Tool result for ${toolName}:\n\`\`\`json\n${toolResultStr}\n\`\`\`\nContinue.`,
      });
    }

    const partialSummary =
      toolsUsed.length > 0
        ? `Tools used so far: ${[...new Set(toolsUsed)].join(', ')}.`
        : 'No tools were called.';
    logger.warn(`FunctionCaller Anthropic: hard iteration cap (${maxIterations}) reached`, {
      toolsUsed,
      toolCallCount: toolCallHistory.length,
    });
    return {
      response:
        `⚠️ Task reached the iteration limit (${maxIterations} steps). The agent stopped to prevent infinite loops. ` +
        `Here is what was completed so far: ${partialSummary}`,
      toolsUsed,
      toolsCalledCount: toolsUsed.length,
      toolCallHistory,
    };
  }

  private async runOllamaLoop(
    systemPrompt: string,
    history: ConversationMessage[],
    userMessage: string,
    toolsUsed: string[],
    toolCallHistory: ToolCallRecord[]
  ): Promise<FunctionCallerResult> {
    const toolDescriptions = toolRegistry.toDescriptionList();
    const fullPrompt =
      `${systemPrompt}\n\nAvailable tools:\n${toolDescriptions}\n\n` +
      `Conversation history:\n${history.map((m) => `${m.role}: ${m.content}`).join('\n')}\n\n` +
      `User: ${userMessage}\n\nAssistant:`;

    const fallbacks = config.fallbackModels ?? [];
    const maxRetries = config.aiMaxRetries;
    const baseDelay = config.aiRetryDelayMs;
    const ollamaUrl = config.ollamaBaseUrl;
    const primaryModel = config.aiModel;

    try {
      const response = await withRetryAndFailover(
        () => axios.post(`${ollamaUrl}/api/generate`, {
          model: primaryModel,
          prompt: fullPrompt,
          stream: false,
        }),
        (fb, fbClient) => fbClient.chat.completions.create({
          model: fb.model,
          messages: [{ role: 'user', content: fullPrompt }],
          max_tokens: 4096,
        }).then((r) => ({ data: { response: r.choices[0]?.message?.content ?? '' } })),
        fallbacks,
        maxRetries,
        baseDelay,
      );

      return {
        response: response.data.response || 'No response from Ollama.',
        toolsUsed,
        toolsCalledCount: toolsUsed.length,
        toolCallHistory,
      };
    } catch (error: any) {
      logger.error('Ollama request failed (all retries and fallbacks exhausted)', { error });
      return {
        response: `Ollama error: ${error.message}`,
        toolsUsed: [],
        toolsCalledCount: 0,
        toolCallHistory: [],
      };
    }
  }

  private async runCustomLoop(
    systemPrompt: string,
    history: ConversationMessage[],
    userMessage: string,
    platform: Platform,
    chatId: string,
    userId: string,
    toolsUsed: string[],
    toolCallHistory: ToolCallRecord[],
    maxIterations: number
  ): Promise<FunctionCallerResult> {
    if (!this.openaiClient) {
      return {
        response: 'Custom AI client not initialized. Check CUSTOM_AI_BASE_URL.',
        toolsUsed: [],
        toolsCalledCount: 0,
        toolCallHistory: [],
      };
    }

    const model = config.customAiModel || config.aiModel;

    let messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
      ...history.map((m): OpenAI.Chat.ChatCompletionMessageParam => {
        if (m.role === 'tool') {
          return {
            role: 'tool',
            tool_call_id: m.toolCallId || 'unknown',
            content: m.content,
          };
        }
        return { role: m.role as 'user' | 'assistant', content: m.content };
      }),
      { role: 'user', content: userMessage },
    ];

    const tools = toolRegistry.toOpenAiFunctions();
    const fallbacks = config.fallbackModels ?? [];
    const maxRetries = config.aiMaxRetries;
    const baseDelay = config.aiRetryDelayMs;
    const primaryClient = this.openaiClient;

    for (let i = 0; i < maxIterations; i++) {
      logger.info(`FunctionCaller Custom iteration ${i + 1}/${maxIterations}`);

      // Trim messages to fit context window before each API call
      const trimmedMessages = trimMessagesToFitContext(messages, systemPrompt) as OpenAI.Chat.ChatCompletionMessageParam[];
      if (trimmedMessages.length < messages.length) {
        logger.warn(`FunctionCaller Custom: context trimmed — removed ${messages.length - trimmedMessages.length} messages to fit token limit`);
        messages = trimmedMessages;
      }

      const response = await withRetryAndFailover(
        () => primaryClient.chat.completions.create({
          model,
          messages: [{ role: 'system', content: systemPrompt }, ...messages],
          tools,
          tool_choice: 'auto',
          max_tokens: 4096,
        }),
        (fb, fbClient) => fbClient.chat.completions.create({
          model: fb.model,
          messages: [{ role: 'system', content: systemPrompt }, ...messages],
          tools,
          tool_choice: 'auto',
          max_tokens: 4096,
        }),
        fallbacks,
        maxRetries,
        baseDelay,
      );

      const choice = response.choices[0];
      if (!choice) break;

      const assistantMessage = choice.message;
      messages.push(assistantMessage as OpenAI.Chat.ChatCompletionMessageParam);

      if (!assistantMessage.tool_calls || assistantMessage.tool_calls.length === 0) {
        const responseText = assistantMessage.content || 'Task completed.';
        return {
          response: responseText,
          toolsUsed,
          toolsCalledCount: toolsUsed.length,
          toolCallHistory,
        };
      }

      for (const toolCall of assistantMessage.tool_calls) {
        const toolName = toolCall.function.name;
        const toolParams = JSON.parse(toolCall.function.arguments || '{}');

        if (toolName === 'shell_execute') {
          toolParams.platform = platform;
          toolParams.chatId = chatId;
          toolParams.userId = userId;
        }

        logger.info(`FunctionCaller: executing tool (custom) "${toolName}"`, { params: toolParams });
        toolsUsed.push(toolName);

        const tool = toolRegistry.getTool(toolName);
        let toolResult: unknown;

        if (!tool) {
          toolResult = { success: false, error: `Tool not found: ${toolName}` };
        } else {
          toolResult = await tool.execute(toolParams);
        }

        const record: ToolCallRecord = {
          name: toolName,
          args: JSON.stringify(toolParams),
          result: JSON.stringify(toolResult),
        };
        toolCallHistory.push(record);

        // Check for tool loop
        const loopMessage = this.detectToolLoop(toolCallHistory);
        if (loopMessage) {
          logger.warn(`FunctionCaller (custom): ${loopMessage}`);
          return {
            response: `⚠️ ${loopMessage}`,
            toolsUsed,
            toolsCalledCount: toolsUsed.length,
            toolCallHistory,
          };
        }

        messages.push({
          role: 'tool',
          tool_call_id: toolCall.id,
          content: sanitizeToolResult(toolResult, toolName),
        });
      }
    }

    const partialSummary =
      toolsUsed.length > 0
        ? `Tools used so far: ${[...new Set(toolsUsed)].join(', ')}.`
        : 'No tools were called.';
    logger.warn(`FunctionCaller Custom: hard iteration cap (${maxIterations}) reached`, {
      toolsUsed,
      toolCallCount: toolCallHistory.length,
    });
    return {
      response:
        `⚠️ Task reached the iteration limit (${maxIterations} steps). The agent stopped to prevent infinite loops. ` +
        `Here is what was completed so far: ${partialSummary}`,
      toolsUsed,
      toolsCalledCount: toolsUsed.length,
      toolCallHistory,
    };
  }
}

export const functionCaller = new FunctionCaller();
export default functionCaller;
