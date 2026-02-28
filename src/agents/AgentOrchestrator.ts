// src/agents/AgentOrchestrator.ts
// Spawns sub-agent processes, tracks them in memory, handles IPC events,
// enforces concurrency limits, and pushes progress to the user via the Gateway.

import { fork, ChildProcess } from 'child_process';
import path from 'path';
import { EventEmitter } from 'events';
import {
  SubAgentTask,
  AgentHandle,
  SpawnAgentParams,
  SubAgentIPCMessage,
  MasterIPCMessage,
} from './types';
import { taskStore } from './TaskStore';
import { logger } from '../logger';

const MAX_CONCURRENT_AGENTS = parseInt(process.env.MAX_CONCURRENT_AGENTS || '5', 10);

// Resolve sub-agent entry point:
// - In production (compiled): dist/agents/SubAgent.js
// - In development (ts-node/tsx): src/agents/SubAgent.ts
const isDev = process.env.NODE_ENV !== 'production' &&
  !require('fs').existsSync(path.resolve(process.cwd(), 'dist', 'agents', 'SubAgent.js'));

const SUB_AGENT_ENTRY = isDev
  ? path.resolve(process.cwd(), 'src', 'agents', 'SubAgent.ts')
  : path.resolve(__dirname, 'SubAgent.js');

const EXEC_ARGV = isDev ? ['-r', 'ts-node/register'] : ['--max-old-space-size=512'];

export class AgentOrchestrator extends EventEmitter {
  // In-memory map of running agents: taskId → AgentHandle
  private handles: Map<string, AgentHandle> = new Map();

  // Callback for pushing messages to user (set by Brain per-request)
  private notifyUser: ((text: string) => void) | null = null;

  constructor() {
    super();
    // Clean up old task files on startup
    try {
      taskStore.cleanupOldTasks();
    } catch (e) {
      logger.warn('AgentOrchestrator: failed to clean up old tasks', { e });
    }
  }

  /**
   * Set the callback used to push progress notifications to the current user.
   * Brain calls this on every incoming message so notifications go to the right chat.
   */
  setNotifyCallback(fn: (text: string) => void): void {
    this.notifyUser = fn;
  }

  getRunningCount(): number {
    return this.handles.size;
  }

  async spawn(params: SpawnAgentParams): Promise<SubAgentTask> {
    if (this.handles.size >= MAX_CONCURRENT_AGENTS) {
      throw new Error(
        `Max concurrent sub-agents (${MAX_CONCURRENT_AGENTS}) reached. ` +
        `Kill an existing agent or wait for one to complete.`
      );
    }

    // Create task record in data/tasks/
    const task = taskStore.createTask(params);
    logger.info(`AgentOrchestrator: spawning sub-agent ${task.id} (${task.label}) via ${task.provider}/${task.model}`);

    // Fork the sub-agent process
    const child = fork(SUB_AGENT_ENTRY, [], {
      execArgv: EXEC_ARGV,
      env: { ...process.env },
      stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
    });

    // Pipe sub-agent stdout/stderr to our logger
    child.stdout?.on('data', (d: Buffer) => {
      logger.debug(`[SubAgent:${task.id.slice(0, 8)}] ${d.toString().trim()}`);
    });
    child.stderr?.on('data', (d: Buffer) => {
      logger.warn(`[SubAgent:${task.id.slice(0, 8)}] STDERR: ${d.toString().trim()}`);
    });

    // Set up timeout
    const timeoutMs = task.timeoutMs || 600000;
    const timeoutTimer = setTimeout(() => {
      logger.warn(`AgentOrchestrator: sub-agent ${task.id} timed out after ${timeoutMs}ms`);
      this.killAgent(task.id, 'Timeout exceeded');
    }, timeoutMs);

    const handle: AgentHandle = { task, process: child, timeoutTimer };
    this.handles.set(task.id, handle);

    // Handle IPC messages from child
    child.on('message', (msg: SubAgentIPCMessage) => {
      this.handleChildMessage(task.id, msg);
    });

    // Handle process exit
    child.on('exit', (code, signal) => {
      clearTimeout(timeoutTimer);
      this.handles.delete(task.id);
      const current = taskStore.read(task.id);
      if (current && current.status === 'running') {
        // Process exited without sending complete/error — treat as failure
        taskStore.update(task.id, {
          status: 'failed',
          error: `Process exited unexpectedly (code=${code}, signal=${signal})`,
          completedAt: new Date().toISOString(),
        });
        this.notify(`❌ Sub-agent *${task.label}* exited unexpectedly (code=${code})`);
      }
      logger.info(`AgentOrchestrator: sub-agent ${task.id} exited (code=${code}, signal=${signal})`);
    });

    // Send init message to child with the full task definition
    const initMsg: MasterIPCMessage = { type: 'init', task };
    child.send(initMsg);

    // Update task to running
    taskStore.update(task.id, { status: 'running', startedAt: new Date().toISOString() });

    return task;
  }

  killAgent(taskId: string, reason: string = 'Killed by master'): boolean {
    const handle = this.handles.get(taskId);
    if (!handle) return false;

    clearTimeout(handle.timeoutTimer);

    // Send SIGTERM first, then SIGKILL after 5s if still alive
    handle.process.kill('SIGTERM');
    setTimeout(() => {
      if (!handle.process.killed) {
        handle.process.kill('SIGKILL');
      }
    }, 5000);

    this.handles.delete(taskId);

    taskStore.update(taskId, {
      status: 'killed',
      error: reason,
      completedAt: new Date().toISOString(),
    });

    this.notify(`🛑 Sub-agent *${handle.task.label}* killed: ${reason}`);
    logger.info(`AgentOrchestrator: killed sub-agent ${taskId} — ${reason}`);
    return true;
  }

  killAll(): void {
    for (const taskId of Array.from(this.handles.keys())) {
      this.killAgent(taskId, 'Master shutdown');
    }
  }

  private handleChildMessage(taskId: string, msg: SubAgentIPCMessage): void {
    logger.debug(`AgentOrchestrator: IPC from ${taskId.slice(0, 8)}: ${msg.type}`);

    switch (msg.type) {
      case 'ready':
        taskStore.update(taskId, { pid: msg.pid });
        break;

      case 'progress': {
        taskStore.update(taskId, {
          toolsUsed: msg.toolsUsed,
          iteration: msg.iteration,
        });
        const progressTask = taskStore.read(taskId);
        this.notify(`⚙️ *${progressTask?.label ?? taskId}* — ${msg.message}`);
        break;
      }

      case 'tool_call':
        logger.info(`[SubAgent:${taskId.slice(0, 8)}] tool: ${msg.toolName}`);
        break;

      case 'complete': {
        const handle = this.handles.get(taskId);
        if (handle) clearTimeout(handle.timeoutTimer);
        this.handles.delete(taskId);

        taskStore.update(taskId, {
          status: 'completed',
          result: msg.result,
          toolsUsed: msg.toolsUsed,
          completedAt: new Date().toISOString(),
        });

        const completeTask = taskStore.read(taskId);
        const durationSec = Math.round(msg.durationMs / 1000);
        this.notify(
          `✅ Sub-agent *${completeTask?.label ?? taskId}* completed in ${durationSec}s\n\n${msg.result}`
        );
        this.emit('complete', taskId, msg.result);
        break;
      }

      case 'error': {
        const handle = this.handles.get(taskId);
        if (handle) clearTimeout(handle.timeoutTimer);
        this.handles.delete(taskId);

        taskStore.update(taskId, {
          status: 'failed',
          error: msg.error,
          completedAt: new Date().toISOString(),
        });

        const errorTask = taskStore.read(taskId);
        this.notify(`❌ Sub-agent *${errorTask?.label ?? taskId}* failed: ${msg.error}`);
        this.emit('error', taskId, msg.error);
        break;
      }
    }
  }

  private notify(text: string): void {
    if (this.notifyUser) {
      try {
        this.notifyUser(text);
      } catch (e) {
        logger.warn('AgentOrchestrator: notify callback threw', { e });
      }
    }
  }
}

export const agentOrchestrator = new AgentOrchestrator();
export default agentOrchestrator;
