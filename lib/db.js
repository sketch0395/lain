import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import threatIntelTool from "../tools-agent/shared/tools/threatIntel";
import playbooksTool from "../tools-agent/shared/tools/playbooks";
import incidentReportsTool from "../tools-agent/shared/tools/incidentReports";
import cyberNewsTool from "../tools-agent/shared/tools/cyberNews";
import toolCallLogTool from "../tools-agent/shared/tools/toolCallLog";

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
    CREATE TABLE IF NOT EXISTS pending_tool_calls (
      id TEXT PRIMARY KEY,
      data TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );
  `);
  // threat_intel table + FTS5 index/triggers live in the shared
  // assistant-tools module (tools-agent/shared/tools/threatIntel.js) so
  // the schema is a single source of truth, not copy-pasted SQL.
  threatIntelTool.ensureSchema(db);
  // playbooks table + FTS5 index/triggers live in the shared assistant-
  // tools module (tools-agent/shared/tools/playbooks.js) — same pattern
  // as threat_intel, but for step-by-step incident response runbooks.
  playbooksTool.ensureSchema(db);
  // incident_reports/incident_report_drafts tables live in the shared
  // assistant-tools module (tools-agent/shared/tools/incidentReports.js)
  // — companion to playbooks.js: where playbooks are the reference
  // library of what to do, this is the saved record of what actually
  // happened during a real incident.
  incidentReportsTool.ensureSchema(db);
  // cyber_news_sources table lives in the shared assistant-tools module
  // (tools-agent/shared/tools/cyberNews.js) so the schema is a single
  // source of truth, shared with Asuna, instead of copy-pasted SQL.
  cyberNewsTool.ensureSchema(db);
  // tool_call_log table lives in the shared assistant-tools module
  // (tools-agent/shared/tools/toolCallLog.js) — records every tool
  // invocation's outcome so diagnose_tool_calls can answer "what went
  // wrong and why" from real history instead of guessing.
  toolCallLogTool.ensureSchema(db);

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

  // Condensed summary of a long conversation's older messages (see
  // maybeCompactHistory in lib/conversations.js) — lets loadHistory send a
  // short recap instead of dozens of raw, often verbose, past turns,
  // keeping real per-request prompt token usage down without losing
  // context. Distinct from Asuna's cross-conversation `summary` column
  // (n/a here) — this is scoped to a single conversation's own history.
  const convoCols = db.prepare(`PRAGMA table_info(conversations)`).all();
  const hasConvoCol = (name) => convoCols.some((c) => c.name === name);
  if (!hasConvoCol("history_summary")) {
    db.exec(`ALTER TABLE conversations ADD COLUMN history_summary TEXT`);
  }
  if (!hasConvoCol("history_summary_through_id")) {
    db.exec(`ALTER TABLE conversations ADD COLUMN history_summary_through_id INTEGER`);
  }

  return db;
}
