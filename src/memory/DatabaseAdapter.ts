/**
 * DatabaseAdapter.ts
 *
 * Unified SQLite adapter that works on both VPS (better-sqlite3, native/fast)
 * and Android/Termux (sql.js, pure WebAssembly — no native compilation needed).
 *
 * Auto-detects the environment and selects the appropriate driver.
 */

import fs from 'fs';
import path from 'path';
import { logger } from '../logger';

// ─── Shared interfaces ────────────────────────────────────────────────────────

export interface DbStatement {
  run(...params: any[]): { changes: number; lastInsertRowid: number | bigint };
  get(...params: any[]): any;
  all(...params: any[]): any[];
}

export interface DbAdapter {
  prepare(sql: string): DbStatement;
  exec(sql: string): void;
  pragma(pragma: string): any;
  close(): void;
}

// ─── BetterSqliteAdapter (VPS / Linux) ───────────────────────────────────────

class BetterSqliteStatement implements DbStatement {
  constructor(private stmt: any) {}

  run(...params: any[]): { changes: number; lastInsertRowid: number | bigint } {
    const result = this.stmt.run(...params);
    return { changes: result.changes, lastInsertRowid: result.lastInsertRowid };
  }

  get(...params: any[]): any {
    return this.stmt.get(...params);
  }

  all(...params: any[]): any[] {
    return this.stmt.all(...params);
  }
}

class BetterSqliteAdapter implements DbAdapter {
  private db: any;

  constructor(dbPath: string) {
    // Dynamic require so that import failure on Android doesn't crash the module
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const Database = require('better-sqlite3');
    this.db = new Database(dbPath);
  }

  prepare(sql: string): DbStatement {
    return new BetterSqliteStatement(this.db.prepare(sql));
  }

  exec(sql: string): void {
    this.db.exec(sql);
  }

  pragma(pragma: string): any {
    return this.db.pragma(pragma);
  }

  close(): void {
    this.db.close();
  }
}

// ─── SqlJsAdapter (Android / Termux) ─────────────────────────────────────────

/**
 * sql.js stores the database entirely in memory (a Uint8Array).
 * We load from disk on startup and flush to disk after every write.
 *
 * sql.js API differs from better-sqlite3:
 *   - db.run(sql, params)          — execute with bound params
 *   - db.prepare(sql)              — returns a Statement object
 *   - stmt.bind(params)            — bind params
 *   - stmt.step()                  — advance cursor (returns boolean)
 *   - stmt.getAsObject()           — current row as plain object
 *   - stmt.free()                  — release statement
 *   - db.getRowsModified()         — rows affected by last DML
 *   - db.export()                  — Uint8Array of the whole DB file
 */

class SqlJsStatement implements DbStatement {
  constructor(
    private sqlJsDb: any,
    private sql: string,
    private saveCallback: () => void
  ) {}

  run(...params: any[]): { changes: number; lastInsertRowid: number | bigint } {
    // sql.js run() accepts (sql, params) — params must be an array or object
    this.sqlJsDb.run(this.sql, params.length === 1 && Array.isArray(params[0]) ? params[0] : params);
    const changes = this.sqlJsDb.getRowsModified();
    this.saveCallback();
    return { changes, lastInsertRowid: 0 };
  }

  get(...params: any[]): any {
    const stmt = this.sqlJsDb.prepare(this.sql);
    try {
      const bindParams = params.length === 1 && Array.isArray(params[0]) ? params[0] : params;
      if (bindParams.length > 0) {
        stmt.bind(bindParams);
      }
      if (stmt.step()) {
        return stmt.getAsObject();
      }
      return undefined;
    } finally {
      stmt.free();
    }
  }

  all(...params: any[]): any[] {
    const stmt = this.sqlJsDb.prepare(this.sql);
    try {
      const bindParams = params.length === 1 && Array.isArray(params[0]) ? params[0] : params;
      if (bindParams.length > 0) {
        stmt.bind(bindParams);
      }
      const results: any[] = [];
      while (stmt.step()) {
        results.push(stmt.getAsObject());
      }
      return results;
    } finally {
      stmt.free();
    }
  }
}

class SqlJsAdapter implements DbAdapter {
  private sqlJsDb: any;
  private dbPath: string;

  constructor(dbPath: string, sqlJsDb: any) {
    this.dbPath = dbPath;
    this.sqlJsDb = sqlJsDb;
  }

  private save(): void {
    try {
      const data: Uint8Array = this.sqlJsDb.export();
      fs.writeFileSync(this.dbPath, Buffer.from(data));
    } catch (err: any) {
      logger.error('SqlJsAdapter: failed to persist database to disk', { error: err.message });
    }
  }

  prepare(sql: string): DbStatement {
    return new SqlJsStatement(this.sqlJsDb, sql, () => this.save());
  }

  exec(sql: string): void {
    this.sqlJsDb.run(sql);
    this.save();
  }

  /**
   * sql.js does not support PRAGMA via a separate method.
   * We execute it as a regular SQL statement and return the result.
   * WAL mode is not supported in sql.js (in-memory), so we silently ignore it.
   */
  pragma(pragma: string): any {
    const lower = pragma.toLowerCase().trim();
    // WAL journal mode is not meaningful for sql.js (in-memory + file flush)
    if (lower.startsWith('journal_mode')) {
      return 'memory';
    }
    try {
      const stmt = this.sqlJsDb.prepare(`PRAGMA ${pragma}`);
      if (stmt.step()) {
        const result = stmt.getAsObject();
        stmt.free();
        return result;
      }
      stmt.free();
    } catch {
      // Ignore unsupported pragmas
    }
    return undefined;
  }

  close(): void {
    this.save();
    this.sqlJsDb.close();
  }
}

// ─── Environment detection ────────────────────────────────────────────────────

function isTermux(): boolean {
  return (
    !!process.env.TERMUX_VERSION ||
    fs.existsSync('/data/data/com.termux') ||
    fs.existsSync('/data/data/com.termux/files/usr/bin/node')
  );
}

// ─── Factory ──────────────────────────────────────────────────────────────────

/**
 * Creates and returns the appropriate database adapter for the current platform.
 *
 * - On Termux/Android: uses sql.js (pure WebAssembly, no native compilation)
 * - On VPS/Linux:      uses better-sqlite3 (native, fast)
 * - Fallback:          if better-sqlite3 fails to load, falls back to sql.js
 */
export async function createDatabase(dbPath: string): Promise<DbAdapter> {
  const termux = isTermux();

  if (!termux) {
    // Try better-sqlite3 first (fast native driver)
    try {
      const adapter = new BetterSqliteAdapter(dbPath);
      logger.info('DatabaseAdapter: using better-sqlite3 (native)');
      return adapter;
    } catch (err: any) {
      logger.warn(
        'DatabaseAdapter: better-sqlite3 failed to load, falling back to sql.js',
        { error: err.message }
      );
    }
  } else {
    logger.info('DatabaseAdapter: Termux detected — using sql.js (pure JS/WASM)');
  }

  // sql.js fallback (works everywhere)
  return createSqlJsAdapter(dbPath);
}

async function createSqlJsAdapter(dbPath: string): Promise<DbAdapter> {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const initSqlJs = require('sql.js');
  const SQL = await initSqlJs();

  let sqlJsDb: any;
  if (fs.existsSync(dbPath)) {
    const fileBuffer = fs.readFileSync(dbPath);
    sqlJsDb = new SQL.Database(fileBuffer);
    logger.info(`DatabaseAdapter: sql.js loaded existing database from ${dbPath}`);
  } else {
    sqlJsDb = new SQL.Database();
    logger.info(`DatabaseAdapter: sql.js created new in-memory database (will persist to ${dbPath})`);
  }

  return new SqlJsAdapter(dbPath, sqlJsDb);
}
