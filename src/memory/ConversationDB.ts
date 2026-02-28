import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import { ConversationMessage } from '../gateway/types';
import { config } from '../config';
import { logger } from '../logger';

interface DbRow {
  id: number;
  user_id: string;
  platform: string;
  role: string;
  content: string;
  tool_call_id: string | null;
  tool_name: string | null;
  timestamp: string;
}

export class ConversationDB {
  private db: Database.Database;
  private readonly maxMessages = 50;

  constructor() {
    const dbPath = path.resolve(process.cwd(), config.dbPath);
    const dbDir = path.dirname(dbPath);

    if (!fs.existsSync(dbDir)) {
      fs.mkdirSync(dbDir, { recursive: true });
    }

    this.db = new Database(dbPath);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('foreign_keys = ON');
    this.initialize();
    logger.info(`ConversationDB initialized at ${dbPath}`);
  }

  private initialize(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS conversations (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id TEXT NOT NULL,
        platform TEXT NOT NULL,
        role TEXT NOT NULL CHECK(role IN ('user', 'assistant', 'tool')),
        content TEXT NOT NULL,
        tool_call_id TEXT,
        tool_name TEXT,
        timestamp TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE INDEX IF NOT EXISTS idx_conversations_user_platform
        ON conversations(user_id, platform);

      CREATE INDEX IF NOT EXISTS idx_conversations_timestamp
        ON conversations(timestamp);
    `);
  }

  addMessage(
    userId: string,
    platform: string,
    message: Omit<ConversationMessage, 'timestamp'>
  ): void {
    try {
      const stmt = this.db.prepare(`
        INSERT INTO conversations (user_id, platform, role, content, tool_call_id, tool_name, timestamp)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `);

      stmt.run(
        userId,
        platform,
        message.role,
        message.content,
        message.toolCallId ?? null,
        message.toolName ?? null,
        new Date().toISOString()
      );

      this.pruneMessages(userId, platform);
    } catch (error) {
      logger.error('Failed to add message to ConversationDB', { error });
    }
  }

  private pruneMessages(userId: string, platform: string): void {
    try {
      const countStmt = this.db.prepare(`
        SELECT COUNT(*) as count FROM conversations
        WHERE user_id = ? AND platform = ?
      `);
      const row = countStmt.get(userId, platform) as { count: number };

      if (row.count > this.maxMessages) {
        const deleteCount = row.count - this.maxMessages;
        this.db
          .prepare(`
          DELETE FROM conversations
          WHERE id IN (
            SELECT id FROM conversations
            WHERE user_id = ? AND platform = ?
            ORDER BY timestamp ASC
            LIMIT ?
          )
        `)
          .run(userId, platform, deleteCount);
      }
    } catch (error) {
      logger.error('Failed to prune messages', { error });
    }
  }

  getHistory(userId: string, platform: string, limit: number = 20): ConversationMessage[] {
    try {
      const rows = this.db
        .prepare(`
        SELECT * FROM conversations
        WHERE user_id = ? AND platform = ?
        ORDER BY timestamp DESC
        LIMIT ?
      `)
        .all(userId, platform, limit) as DbRow[];

      return rows.reverse().map((row) => ({
        role: row.role as 'user' | 'assistant' | 'tool',
        content: row.content,
        toolCallId: row.tool_call_id ?? undefined,
        toolName: row.tool_name ?? undefined,
        timestamp: new Date(row.timestamp),
      }));
    } catch (error) {
      logger.error('Failed to get conversation history', { error });
      return [];
    }
  }

  /**
   * Returns only the last N messages for a given chat (alias for getHistory with explicit limit).
   * Used by Brain to cap context sent to the AI.
   */
  getRecentMessages(chatId: string, limit: number): ConversationMessage[] {
    // chatId is stored as user_id in this DB; platform is embedded in chatId for multi-platform support.
    // We delegate to getHistory which already supports limit.
    return this.getHistory(chatId, 'telegram', limit);
  }

  /**
   * Deletes messages older than the keepLast count for a given user+platform pair.
   * Useful for manual pruning beyond the automatic maxMessages cap.
   */
  pruneOldMessages(userId: string, platform: string, keepLast: number): void {
    try {
      const countStmt = this.db.prepare(`
        SELECT COUNT(*) as count FROM conversations
        WHERE user_id = ? AND platform = ?
      `);
      const row = countStmt.get(userId, platform) as { count: number };

      if (row.count > keepLast) {
        const deleteCount = row.count - keepLast;
        this.db
          .prepare(`
          DELETE FROM conversations
          WHERE id IN (
            SELECT id FROM conversations
            WHERE user_id = ? AND platform = ?
            ORDER BY timestamp ASC
            LIMIT ?
          )
        `)
          .run(userId, platform, deleteCount);
        logger.info(`ConversationDB: pruned ${deleteCount} old messages for ${platform}:${userId}`);
      }
    } catch (error) {
      logger.error('Failed to prune old messages', { error });
    }
  }

  clearHistory(userId: string, platform: string): void {
    try {
      this.db
        .prepare(`
        DELETE FROM conversations WHERE user_id = ? AND platform = ?
      `)
        .run(userId, platform);
      logger.info(`Cleared conversation history for ${platform}:${userId}`);
    } catch (error) {
      logger.error('Failed to clear conversation history', { error });
    }
  }

  getStats(): { totalMessages: number; uniqueUsers: number } {
    try {
      const total = (
        this.db.prepare('SELECT COUNT(*) as count FROM conversations').get() as { count: number }
      ).count;
      const users = (
        this.db
          .prepare('SELECT COUNT(DISTINCT user_id) as count FROM conversations')
          .get() as { count: number }
      ).count;
      return { totalMessages: total, uniqueUsers: users };
    } catch (error) {
      logger.error('Failed to get DB stats', { error });
      return { totalMessages: 0, uniqueUsers: 0 };
    }
  }

  close(): void {
    this.db.close();
  }
}

export const conversationDB = new ConversationDB();
export default conversationDB;
