// src/agents/TaskStore.ts
// Reads and writes task state to data/tasks/<taskId>.json
// Synchronous fs operations are acceptable since tasks are written infrequently

import fs from 'fs';
import path from 'path';
import { randomUUID } from 'crypto';
import { SubAgentTask, TaskStatus, SpawnAgentParams } from './types';
import { config } from '../config';
import { logger } from '../logger';

const TASKS_DIR = path.resolve(process.cwd(), 'data/tasks');

export class TaskStore {
  constructor() {
    if (!fs.existsSync(TASKS_DIR)) {
      fs.mkdirSync(TASKS_DIR, { recursive: true });
    }
  }

  createTask(params: SpawnAgentParams): SubAgentTask {
    const task: SubAgentTask = {
      id: randomUUID(),
      parentTaskId: null,
      label: params.label,
      model: params.model ?? config.aiModel,
      provider: params.provider ?? (config.aiProvider as import('./types').AIProvider),
      prompt: params.prompt,
      status: 'pending',
      result: null,
      toolsUsed: [],
      iteration: 0,
      pid: null,
      startedAt: null,
      completedAt: null,
      error: null,
      timeoutMs: params.timeoutMs ?? 600000,
      createdAt: new Date().toISOString(),
    };
    this.write(task);
    return task;
  }

  read(taskId: string): SubAgentTask | null {
    const filePath = this.taskPath(taskId);
    if (!fs.existsSync(filePath)) return null;
    try {
      return JSON.parse(fs.readFileSync(filePath, 'utf-8')) as SubAgentTask;
    } catch (e) {
      logger.error(`TaskStore: failed to read ${taskId}`, { e });
      return null;
    }
  }

  write(task: SubAgentTask): void {
    if (!fs.existsSync(TASKS_DIR)) {
      fs.mkdirSync(TASKS_DIR, { recursive: true });
    }
    fs.writeFileSync(this.taskPath(task.id), JSON.stringify(task, null, 2), 'utf-8');
  }

  update(taskId: string, patch: Partial<SubAgentTask>): SubAgentTask | null {
    const task = this.read(taskId);
    if (!task) return null;
    const updated = { ...task, ...patch };
    this.write(updated);
    return updated;
  }

  listAll(): SubAgentTask[] {
    if (!fs.existsSync(TASKS_DIR)) return [];
    return fs.readdirSync(TASKS_DIR)
      .filter(f => f.endsWith('.json'))
      .map(f => {
        try {
          return JSON.parse(fs.readFileSync(path.join(TASKS_DIR, f), 'utf-8')) as SubAgentTask;
        } catch { return null; }
      })
      .filter((t): t is SubAgentTask => t !== null)
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  }

  listByStatus(status: TaskStatus): SubAgentTask[] {
    return this.listAll().filter(t => t.status === status);
  }

  /**
   * Delete task files older than olderThanMs (default: 7 days) that are in a terminal state.
   * Returns the number of deleted files.
   */
  cleanupOldTasks(olderThanMs: number = 7 * 24 * 60 * 60 * 1000): number {
    const cutoff = Date.now() - olderThanMs;
    const tasks = this.listAll();
    let deleted = 0;
    for (const task of tasks) {
      if (['completed', 'failed', 'killed'].includes(task.status)) {
        const age = Date.now() - new Date(task.createdAt).getTime();
        if (age > cutoff) {
          try {
            fs.unlinkSync(this.taskPath(task.id));
            deleted++;
          } catch (e) {
            logger.warn(`TaskStore: failed to delete ${task.id}`, { e });
          }
        }
      }
    }
    if (deleted > 0) {
      logger.info(`TaskStore: cleaned up ${deleted} old task file(s)`);
    }
    return deleted;
  }

  private taskPath(taskId: string): string {
    return path.join(TASKS_DIR, `${taskId}.json`);
  }
}

export const taskStore = new TaskStore();
export default taskStore;
