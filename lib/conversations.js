import { randomUUID } from "node:crypto";
import { getDb } from "./db";

const HISTORY_LIMIT = Number(process.env.LAIN_HISTORY_LIMIT || 40);

export function ensureConversation(conversationId) {
  const db = getDb();
  if (conversationId) {
    const row = db
      .prepare("SELECT id FROM conversations WHERE id = ?")
      .get(conversationId);
    if (row) return conversationId;
  }
  const newId = randomUUID();
  db.prepare(
    "INSERT INTO conversations (id, title, created_at) VALUES (?, ?, ?)"
  ).run(newId, "New chat", Date.now() / 1000);
  return newId;
}

export function saveMessage(conversationId, role, content) {
  const db = getDb();
  db.prepare(
    "INSERT INTO messages (conversation_id, role, content, created_at) VALUES (?, ?, ?, ?)"
  ).run(conversationId, role, content, Date.now() / 1000);
}

// After a confirmed tool call, app/api/chat/confirm/route.js prefixes the
// saved assistant message with a human-readable "*(did thing X)*" marker
// so the chat UI shows what actually ran. If that raw text is fed back to
// the model as prior conversation context, the model tends to imitate its
// own past marker verbatim on a later turn — outputting the parenthetical
// description as plain text instead of actually invoking the tool again.
// Strip it here so the LLM never sees (and can't copy) that surface
// pattern; the unstripped version stays in the DB for the UI to render.
const TOOL_SUMMARY_PREFIX_RE = /^\*\(.+?\)\*\n\n/s;

export function loadHistory(conversationId, limit = HISTORY_LIMIT) {
  const db = getDb();
  const rows = db
    .prepare(
      "SELECT role, content FROM messages WHERE conversation_id = ? ORDER BY id DESC LIMIT ?"
    )
    .all(conversationId, limit);
  return rows.reverse().map((r) => ({
    role: r.role,
    content:
      r.role === "assistant" ? r.content.replace(TOOL_SUMMARY_PREFIX_RE, "") : r.content,
  }));
}

export function listConversations() {
  const db = getDb();
  return db
    .prepare(
      `SELECT c.id, c.title, c.created_at,
              COALESCE(MAX(m.created_at), c.created_at) AS last_active
       FROM conversations c
       LEFT JOIN messages m ON m.conversation_id = c.id
       GROUP BY c.id
       ORDER BY last_active DESC`
    )
    .all();
}

export function deleteConversation(conversationId) {
  const db = getDb();
  db.prepare("DELETE FROM messages WHERE conversation_id = ?").run(
    conversationId
  );
  db.prepare("DELETE FROM conversations WHERE id = ?").run(conversationId);
}

/** Deletes every conversation and message. Returns the number of conversations removed. */
export function deleteAllConversations() {
  const db = getDb();
  db.prepare("DELETE FROM messages").run();
  const info = db.prepare("DELETE FROM conversations").run();
  return info.changes;
}

/** Renames a conversation. Used by the "rename chat" UI and the CLI. */
export function renameConversation(conversationId, title) {
  const db = getDb();
  const clean = title.trim().slice(0, 100);
  if (!clean) return false;
  const result = db
    .prepare("UPDATE conversations SET title = ? WHERE id = ?")
    .run(clean, conversationId);
  return result.changes > 0;
}

/** Sets the conversation title from the first user message, once. */
export function maybeSetTitle(conversationId, firstMessage) {
  const db = getDb();
  const row = db
    .prepare("SELECT title FROM conversations WHERE id = ?")
    .get(conversationId);
  if (row && row.title === "New chat") {
    const title = firstMessage.slice(0, 60);
    db.prepare("UPDATE conversations SET title = ? WHERE id = ?").run(
      title,
      conversationId
    );
  }
}
