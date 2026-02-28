// src/agents/types.ts
// All TypeScript interfaces for the sub-agent system

export type TaskStatus = 'pending' | 'running' | 'completed' | 'failed' | 'killed';

export type AIProvider = 'openai' | 'anthropic' | 'groq' | 'ollama' | 'custom';

export interface SubAgentTask {
  id: string;                    // UUID v4
  parentTaskId: string | null;   // null for top-level tasks
  label: string;                 // short human-readable label
  model: string;                 // e.g. "gpt-4o-mini", "claude-3-haiku-20240307"
  provider: AIProvider;          // which AI provider to use
  prompt: string;                // the full task prompt for the sub-agent
  status: TaskStatus;
  result: string | null;         // final response when completed
  toolsUsed: string[];           // accumulated list of tools used
  iteration: number;             // current AI loop iteration
  pid: number | null;            // OS process ID when running
  startedAt: string | null;      // ISO timestamp
  completedAt: string | null;    // ISO timestamp
  error: string | null;          // error message if failed/killed
  timeoutMs: number;             // default: 600000 (10 min)
  createdAt: string;             // ISO timestamp
}

export interface SpawnAgentParams {
  label: string;
  prompt: string;
  model?: string;                // defaults to master's model
  provider?: AIProvider;         // defaults to master's provider
  timeoutMs?: number;            // defaults to 600000
}

export interface AgentHandle {
  task: SubAgentTask;
  process: import('child_process').ChildProcess;
  timeoutTimer: NodeJS.Timeout;
}

// IPC message types — Master → Child
export interface SubAgentInitMessage {
  type: 'init';
  task: SubAgentTask;
}

export interface SubAgentKillMessage {
  type: 'kill';
  reason: string;
}

// IPC message types — Child → Master
export interface SubAgentReadyMessage {
  type: 'ready';
  taskId: string;
  pid: number;
}

export interface SubAgentProgressMessage {
  type: 'progress';
  taskId: string;
  message: string;
  toolsUsed: string[];
  iteration: number;
}

export interface SubAgentToolMessage {
  type: 'tool_call';
  taskId: string;
  toolName: string;
  params: Record<string, unknown>;
  result: unknown;
}

export interface SubAgentCompleteMessage {
  type: 'complete';
  taskId: string;
  result: string;
  toolsUsed: string[];
  durationMs: number;
}

export interface SubAgentErrorMessage {
  type: 'error';
  taskId: string;
  error: string;
  durationMs: number;
}

export type SubAgentIPCMessage =
  | SubAgentReadyMessage
  | SubAgentProgressMessage
  | SubAgentToolMessage
  | SubAgentCompleteMessage
  | SubAgentErrorMessage;

export type MasterIPCMessage =
  | SubAgentInitMessage
  | SubAgentKillMessage;
