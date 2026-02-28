// src/agents/SubAgent.ts
// This file runs as a CHILD PROCESS via child_process.fork()
// It must NOT import anything that requires the master's singleton state
// (no gateway, no conversationDB, no brain singleton)

import OpenAI from 'openai';
import axios from 'axios';
import { SubAgentTask, SubAgentIPCMessage, MasterIPCMessage } from './types';
import { SubAgentToolRegistry } from './SubAgentToolRegistry';
import { logger } from '../logger';

const MAX_ITERATIONS = 15;

// Module-level state for error handlers
let currentTaskId = '';
let startedAt = Date.now();

// ── Graceful error handling ────────────────────────────────────────────────
process.on('uncaughtException', (err) => {
  send({
    type: 'error',
    taskId: currentTaskId,
    error: `Uncaught exception: ${err.message}`,
    durationMs: Date.now() - startedAt,
  });
  process.exit(1);
});

process.on('unhandledRejection', (reason) => {
  send({
    type: 'error',
    taskId: currentTaskId,
    error: `Unhandled rejection: ${String(reason)}`,
    durationMs: Date.now() - startedAt,
  });
  process.exit(1);
});

// ── Wait for init message from master ─────────────────────────────────────
process.on('message', async (msg: MasterIPCMessage) => {
  if (msg.type === 'init') {
    await runSubAgent(msg.task);
  } else if (msg.type === 'kill') {
    logger.info(`SubAgent: received kill signal — ${msg.reason}`);
    process.exit(0);
  }
});

function send(msg: SubAgentIPCMessage): void {
  if (process.send) process.send(msg);
}

async function runSubAgent(task: SubAgentTask): Promise<void> {
  currentTaskId = task.id;
  startedAt = Date.now();

  send({ type: 'ready', taskId: task.id, pid: process.pid });

  try {
    const result = await runAILoop(task);
    const durationMs = Date.now() - startedAt;
    send({ type: 'complete', taskId: task.id, result, toolsUsed: [], durationMs });
    process.exit(0);
  } catch (err: any) {
    const durationMs = Date.now() - startedAt;
    send({ type: 'error', taskId: task.id, error: err?.message || String(err), durationMs });
    process.exit(1);
  }
}

async function runAILoop(task: SubAgentTask): Promise<string> {
  const subAgentRegistry = new SubAgentToolRegistry();
  const toolsUsed: string[] = [];

  const systemPrompt = buildSubAgentSystemPrompt(task, subAgentRegistry);

  // Route to the correct AI loop based on provider
  switch (task.provider) {
    case 'openai':
    case 'groq':
    case 'custom':
      return runOpenAiLoop(task, subAgentRegistry, systemPrompt, toolsUsed);
    case 'anthropic':
      return runAnthropicLoop(task, subAgentRegistry, systemPrompt, toolsUsed);
    case 'ollama':
      return runOllamaLoop(task, subAgentRegistry, systemPrompt, toolsUsed);
    default:
      return runOpenAiLoop(task, subAgentRegistry, systemPrompt, toolsUsed);
  }
}

async function runOpenAiLoop(
  task: SubAgentTask,
  registry: SubAgentToolRegistry,
  systemPrompt: string,
  toolsUsed: string[]
): Promise<string> {
  const client = buildOpenAiClient(task);
  const tools = registry.toOpenAiFunctions();

  const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: task.prompt },
  ];

  for (let i = 0; i < MAX_ITERATIONS; i++) {
    send({
      type: 'progress',
      taskId: task.id,
      message: `AI iteration ${i + 1}/${MAX_ITERATIONS}`,
      toolsUsed,
      iteration: i + 1,
    });

    const model = task.provider === 'custom'
      ? (process.env.CUSTOM_AI_MODEL || task.model)
      : task.model;

    const response = await client.chat.completions.create({
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
      return assistantMessage.content || 'Task completed.';
    }

    for (const toolCall of assistantMessage.tool_calls) {
      const toolName = toolCall.function.name;
      const toolParams = JSON.parse(toolCall.function.arguments || '{}');

      toolsUsed.push(toolName);

      send({
        type: 'tool_call',
        taskId: task.id,
        toolName,
        params: toolParams,
        result: null,
      });

      const tool = registry.getTool(toolName);
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

  return 'Maximum iterations reached. Task may be incomplete.';
}

async function runAnthropicLoop(
  task: SubAgentTask,
  registry: SubAgentToolRegistry,
  systemPrompt: string,
  toolsUsed: string[]
): Promise<string> {
  // Anthropic SDK v0.17.x uses text-based ReAct loop (no native tool calling)
  const Anthropic = require('@anthropic-ai/sdk');
  const client = new Anthropic.default({ apiKey: process.env.ANTHROPIC_API_KEY || '' });

  const toolDescriptions = registry.toDescriptionList();
  const toolNames = registry.getToolNames().join(', ');

  const reactSystemPrompt =
    `${systemPrompt}\n\n` +
    `## Tool Invocation Format\n` +
    `To use a tool, output EXACTLY this JSON block:\n` +
    `\`\`\`tool\n{"tool":"<tool_name>","params":{...}}\n\`\`\`\n` +
    `After the tool result is shown, continue reasoning and either call another tool or give your final answer.\n` +
    `Available tool names: ${toolNames}\n\n` +
    `Tool descriptions:\n${toolDescriptions}`;

  const conversationHistory: Array<{ role: 'user' | 'assistant'; content: string }> = [
    { role: 'user', content: task.prompt },
  ];

  for (let i = 0; i < MAX_ITERATIONS; i++) {
    send({
      type: 'progress',
      taskId: task.id,
      message: `AI iteration ${i + 1}/${MAX_ITERATIONS}`,
      toolsUsed,
      iteration: i + 1,
    });

    const response = await (client.messages as any).create({
      model: task.model,
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

    const toolMatch = assistantText.match(/```tool\s*\n([\s\S]*?)\n```/);

    if (!toolMatch) {
      return assistantText.trim() || 'Task completed.';
    }

    let toolName = '';
    let toolParams: any = {};
    try {
      const parsed = JSON.parse(toolMatch[1].trim());
      toolName = parsed.tool || '';
      toolParams = parsed.params || {};
    } catch {
      return `Failed to parse tool invocation: ${toolMatch[1]}`;
    }

    toolsUsed.push(toolName);

    send({
      type: 'tool_call',
      taskId: task.id,
      toolName,
      params: toolParams,
      result: null,
    });

    const tool = registry.getTool(toolName);
    let toolResult: any;

    if (!tool) {
      toolResult = { success: false, error: `Tool not found: ${toolName}` };
    } else {
      toolResult = await tool.execute(toolParams);
    }

    conversationHistory.push({ role: 'assistant', content: assistantText });
    conversationHistory.push({
      role: 'user',
      content: `Tool result for ${toolName}:\n\`\`\`json\n${JSON.stringify(toolResult)}\n\`\`\`\nContinue.`,
    });
  }

  return 'Maximum iterations reached.';
}

async function runOllamaLoop(
  task: SubAgentTask,
  registry: SubAgentToolRegistry,
  systemPrompt: string,
  toolsUsed: string[]
): Promise<string> {
  const ollamaBaseUrl = process.env.OLLAMA_BASE_URL || 'http://localhost:11434';
  const toolDescriptions = registry.toDescriptionList();

  const fullPrompt =
    `${systemPrompt}\n\nAvailable tools:\n${toolDescriptions}\n\n` +
    `User: ${task.prompt}\n\nAssistant:`;

  send({
    type: 'progress',
    taskId: task.id,
    message: 'Running Ollama inference',
    toolsUsed,
    iteration: 1,
  });

  try {
    const response = await axios.post(`${ollamaBaseUrl}/api/generate`, {
      model: task.model,
      prompt: fullPrompt,
      stream: false,
    });

    return response.data.response || 'No response from Ollama.';
  } catch (error: any) {
    throw new Error(`Ollama error: ${error.message}`);
  }
}

function buildOpenAiClient(task: SubAgentTask): OpenAI {
  switch (task.provider) {
    case 'groq':
      return new OpenAI({
        apiKey: process.env.GROQ_API_KEY || '',
        baseURL: 'https://api.groq.com/openai/v1',
      });
    case 'custom':
      return new OpenAI({
        apiKey: process.env.CUSTOM_AI_API_KEY || 'none',
        baseURL: process.env.CUSTOM_AI_BASE_URL || '',
      });
    case 'openai':
    default:
      return new OpenAI({ apiKey: process.env.OPENAI_API_KEY || '' });
  }
}

function buildSubAgentSystemPrompt(task: SubAgentTask, registry: SubAgentToolRegistry): string {
  const toolList = registry.toDescriptionList();
  return `You are a specialized sub-agent of SuperClaw, an autonomous AI agent running on a Linux Ubuntu VPS.
You have been assigned a specific task by the master agent.

## Your Task
${task.label}

## Available Tools
${toolList}

## Rules
1. Focus ONLY on your assigned task. Do not go beyond its scope.
2. Use tools to accomplish the task fully and autonomously.
3. When done, provide a clear summary of what you accomplished.
4. If you cannot complete the task, explain why clearly.
5. Do not ask for confirmation — execute the task directly.
6. Write results to files when appropriate (use file_write tool).
7. Be concise in your final response — summarize what was done.
8. Do NOT spawn other sub-agents — you do not have that capability.`;
}
