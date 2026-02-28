import OpenAI from 'openai';
import Anthropic from '@anthropic-ai/sdk';
import axios from 'axios';
import { ConversationMessage, Platform } from '../gateway/types';
import { toolRegistry } from './ToolRegistry';
import { config } from '../config';
import { logger } from '../logger';

export interface FunctionCallerResult {
  response: string;
  toolsUsed: string[];
}

const MAX_ITERATIONS = 10;

/**
 * Returns true if the text sounds like the AI is claiming to have done something
 * without actually executing any tools (hallucination indicator).
 */
function looksLikeHallucination(text: string): boolean {
  const lower = text.toLowerCase();
  const claimPhrases = [
    "i have", "i've", "i've", "i created", "i wrote", "i built",
    "i installed", "i configured", "i set up", "i deployed",
    "i updated", "i modified", "i deleted", "i removed",
    "i ran", "i executed", "i started", "i stopped",
    "done", "completed", "finished", "accomplished",
    "successfully created", "successfully installed",
    "successfully configured", "successfully deployed",
  ];
  return claimPhrases.some((phrase) => lower.includes(phrase));
}

const HALLUCINATION_DISCLAIMER =
  '\n\n⚠️ *[Note: I described what I would do but did not execute it. Please ask me again and I will use my tools to actually do it.]*';

// Inline types for the old Anthropic SDK (0.17.x) which lacks tool-use support
interface AnthropicMessageParam {
  role: 'user' | 'assistant';
  content: string;
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
      };
    }

    const toolsUsed: string[] = [];

    if (config.aiProvider === 'openai' || config.aiProvider === 'groq') {
      return this.runOpenAiLoop(
        systemPrompt,
        history,
        userMessage,
        platform,
        chatId,
        userId,
        toolsUsed,
        MAX_ITERATIONS
      );
    } else if (config.aiProvider === 'anthropic') {
      return this.runAnthropicLoop(
        systemPrompt,
        history,
        userMessage,
        toolsUsed
      );
    } else if (config.aiProvider === 'ollama') {
      return this.runOllamaLoop(systemPrompt, history, userMessage, toolsUsed);
    } else if (config.aiProvider === 'custom') {
      return this.runCustomLoop(
        systemPrompt,
        history,
        userMessage,
        platform,
        chatId,
        userId,
        toolsUsed,
        MAX_ITERATIONS
      );
    }

    return { response: 'No AI provider configured.', toolsUsed: [] };
  }

  private async runOpenAiLoop(
    systemPrompt: string,
    history: ConversationMessage[],
    userMessage: string,
    platform: Platform,
    chatId: string,
    userId: string,
    toolsUsed: string[],
    maxIterations: number
  ): Promise<FunctionCallerResult> {
    if (!this.openaiClient) {
      return { response: 'OpenAI/Groq client not initialized.', toolsUsed: [] };
    }

    const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
      { role: 'system', content: systemPrompt },
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

    for (let i = 0; i < maxIterations; i++) {
      logger.info(`FunctionCaller OpenAI iteration ${i + 1}/${maxIterations}`);

      const response = await this.openaiClient.chat.completions.create({
        model: config.aiModel,
        messages,
        tools,
        tool_choice: 'auto',
        max_tokens: 4096,
      });

      const choice = response.choices[0];
      if (!choice) break;

      const assistantMessage = choice.message;
      messages.push(assistantMessage as OpenAI.Chat.ChatCompletionMessageParam);

      if (!assistantMessage.tool_calls || assistantMessage.tool_calls.length === 0) {
        // AI returned text without calling any tools
        const responseText = assistantMessage.content || 'Task completed.';
        // If no tools were used at all and the response sounds like a claim of action,
        // append a disclaimer to warn the user about potential hallucination
        if (toolsUsed.length === 0 && looksLikeHallucination(responseText)) {
          logger.warn('FunctionCaller: AI returned action-claim text without executing any tools (possible hallucination)');
          return {
            response: responseText + HALLUCINATION_DISCLAIMER,
            toolsUsed,
          };
        }
        return {
          response: responseText,
          toolsUsed,
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

        messages.push({
          role: 'tool',
          tool_call_id: toolCall.id,
          content: JSON.stringify(toolResult),
        });
      }
    }

    return {
      response: '⚠️ Maximum iterations reached. Task may be incomplete.',
      toolsUsed,
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
    toolsUsed: string[]
  ): Promise<FunctionCallerResult> {
    if (!this.anthropicClient) {
      return { response: 'Anthropic client not initialized.', toolsUsed: [] };
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

    const maxIterations = 10;

    for (let i = 0; i < maxIterations; i++) {
      logger.debug(`FunctionCaller Anthropic iteration ${i + 1}`);

      const response = await (this.anthropicClient.messages as any).create({
        model: config.aiModel,
        max_tokens: 4096,
        system: reactSystemPrompt,
        messages: conversationHistory,
      });

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
        // No tool call — final answer
        const responseText = assistantText.trim() || 'Task completed.';
        if (toolsUsed.length === 0 && looksLikeHallucination(responseText)) {
          logger.warn('FunctionCaller (anthropic): AI returned action-claim text without executing any tools (possible hallucination)');
          return { response: responseText + HALLUCINATION_DISCLAIMER, toolsUsed };
        }
        return { response: responseText, toolsUsed };
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

      const toolResultStr = JSON.stringify(toolResult);

      // Append assistant turn and tool result as user turn
      conversationHistory.push({ role: 'assistant', content: assistantText });
      conversationHistory.push({
        role: 'user',
        content: `Tool result for ${toolName}:\n\`\`\`json\n${toolResultStr}\n\`\`\`\nContinue.`,
      });
    }

    return { response: 'Maximum iterations reached.', toolsUsed };
  }

  private async runOllamaLoop(
    systemPrompt: string,
    history: ConversationMessage[],
    userMessage: string,
    toolsUsed: string[]
  ): Promise<FunctionCallerResult> {
    const toolDescriptions = toolRegistry.toDescriptionList();
    const fullPrompt =
      `${systemPrompt}\n\nAvailable tools:\n${toolDescriptions}\n\n` +
      `Conversation history:\n${history.map((m) => `${m.role}: ${m.content}`).join('\n')}\n\n` +
      `User: ${userMessage}\n\nAssistant:`;

    try {
      const response = await axios.post(`${config.ollamaBaseUrl}/api/generate`, {
        model: config.aiModel,
        prompt: fullPrompt,
        stream: false,
      });

      return {
        response: response.data.response || 'No response from Ollama.',
        toolsUsed,
      };
    } catch (error: any) {
      logger.error('Ollama request failed', { error });
      return { response: `Ollama error: ${error.message}`, toolsUsed: [] };
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
    maxIterations: number
  ): Promise<FunctionCallerResult> {
    if (!this.openaiClient) {
      return { response: 'Custom AI client not initialized. Check CUSTOM_AI_BASE_URL.', toolsUsed: [] };
    }

    const model = config.customAiModel || config.aiModel;

    const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
      { role: 'system', content: systemPrompt },
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

    for (let i = 0; i < maxIterations; i++) {
      logger.info(`FunctionCaller Custom iteration ${i + 1}/${maxIterations}`);

      const response = await this.openaiClient.chat.completions.create({
        model,
        messages,
        tools,
        tool_choice: 'auto',
        max_tokens: 4096,
      });

      const choice = response.choices[0];
      if (!choice) break;

      const assistantMessage = choice.message;
      messages.push(assistantMessage as OpenAI.Chat.ChatCompletionMessageParam);

      if (!assistantMessage.tool_calls || assistantMessage.tool_calls.length === 0) {
        const responseText = assistantMessage.content || 'Task completed.';
        if (toolsUsed.length === 0 && looksLikeHallucination(responseText)) {
          logger.warn('FunctionCaller (custom): AI returned action-claim text without executing any tools (possible hallucination)');
          return {
            response: responseText + HALLUCINATION_DISCLAIMER,
            toolsUsed,
          };
        }
        return {
          response: responseText,
          toolsUsed,
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

        messages.push({
          role: 'tool',
          tool_call_id: toolCall.id,
          content: JSON.stringify(toolResult),
        });
      }
    }

    return {
      response: '⚠️ Maximum iterations reached. Task may be incomplete.',
      toolsUsed,
    };
  }
}

export const functionCaller = new FunctionCaller();
export default functionCaller;
