import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import threatIntelTool from "../tools-agent/shared/tools/threatIntel";
import cyberNewsTool from "../tools-agent/shared/tools/cyberNews";

const DB_PATH = process.env.LAIN_DB_PATH || "./data/lain.db";

let db;

/**
 * Returns a singleton SQLite connection, creating the schema on first use.
 * A singleton avoids re-opening the file on every request in dev/hot-reload.
 */
export function getDb() {
  if (db) return db;

  fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
  db = new Database(DB_PATH);
  db.pragma("journal_mode = WAL");

  db.exec(`
    CREATE TABLE IF NOT EXISTS conversations (
      id TEXT PRIMARY KEY,
      title TEXT,
      created_at REAL
    );
    CREATE TABLE IF NOT EXISTS messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      conversation_id TEXT NOT NULL,
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      created_at REAL,
      FOREIGN KEY (conversation_id) REFERENCES conversations (id)
    );
    CREATE TABLE IF NOT EXISTS reminders (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      message TEXT NOT NULL,
      action TEXT NOT NULL DEFAULT 'notify',
      repeat TEXT NOT NULL DEFAULT 'once',
      next_run REAL NOT NULL,
      enabled INTEGER NOT NULL DEFAULT 1,
      created_at REAL,
      conversation_id TEXT,
      cron_expr TEXT,
      email_to TEXT
    );
    CREATE TABLE IF NOT EXISTS push_subscriptions (
      endpoint TEXT PRIMARY KEY,
      p256dh TEXT,
      auth TEXT,
      created_at REAL
    );
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT
    );
    CREATE TABLE IF NOT EXISTS memories (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      content TEXT NOT NULL,
      created_at REAL,
      conversation_id TEXT
    );
  `);
  // threat_intel table + FTS5 index/triggers live in the shared
  // assistant-tools module (tools-agent/shared/tools/threatIntel.js) so
  // the schema is a single source of truth, not copy-pasted SQL.
  threatIntelTool.ensureSchema(db);
  // cyber_news_sources table lives in the shared assistant-tools module
  // (tools-agent/shared/tools/cyberNews.js) so the schema is a single
  // source of truth, shared with Asuna, instead of copy-pasted SQL.
  cyberNewsTool.ensureSchema(db);

  // Migrations: columns added after the initial reminders table — existing
  // on-disk databases need them added explicitly since `CREATE TABLE IF NOT
  // EXISTS` doesn't alter existing tables.
  const reminderCols = db.prepare(`PRAGMA table_info(reminders)`).all();
  const hasCol = (name) => reminderCols.some((c) => c.name === name);
  if (!hasCol("cron_expr")) {
    db.exec(`ALTER TABLE reminders ADD COLUMN cron_expr TEXT`);
  }
  if (!hasCol("email_to")) {
    db.exec(`ALTER TABLE reminders ADD COLUMN email_to TEXT`);
  }

  return db;
}
