import { getDb } from "@/lib/db";

// Long-term memory: durable facts Lain has learned about the user over the
// course of conversations (via the remember_fact tool), separate from the
// manually-entered "About Me" profile. Kept small and human-reviewable —
// the user can see/delete anything here from the Memories panel.
const MAX_PROMPT_MEMORIES = 50;

/** Saves a new remembered fact. Returns the created row. */
export function addMemory(content, conversationId = null) {
  const trimmed = String(content || "").trim();
  if (!trimmed) throw new Error("content is required");
  const db = getDb();
  const info = db
    .prepare(
      `INSERT INTO memories (content, created_at, conversation_id) VALUES (?, ?, ?)`
    )
    .run(trimmed, Date.now(), conversationId);
  return { id: info.lastInsertRowid, content: trimmed, created_at: Date.now() };
}

/** Lists all remembered facts, most recent first. */
export function listMemories() {
  const db = getDb();
  return db.prepare(`SELECT * FROM memories ORDER BY created_at DESC`).all();
}

/** Deletes a remembered fact by id. Returns true if a row was removed. */
export function deleteMemory(id) {
  const db = getDb();
  const info = db.prepare(`DELETE FROM memories WHERE id = ?`).run(id);
  return info.changes > 0;
}

/** Deletes every remembered fact. Returns the number of rows removed. */
export function deleteAllMemories() {
  const db = getDb();
  const info = db.prepare(`DELETE FROM memories`).run();
  return info.changes;
}

/**
 * Builds a system-prompt addendum listing remembered facts (most recent
 * first, capped) — or "" if nothing has been learned yet.
 */
export function memoryPromptAddendum() {
  const db = getDb();
  const rows = db
    .prepare(`SELECT content FROM memories ORDER BY created_at DESC LIMIT ?`)
    .all(MAX_PROMPT_MEMORIES);
  if (rows.length === 0) return "";
  const lines = rows.map((r) => `- ${r.content}`).join("\n");
  return (
    `\n\nThings you've learned and remembered about the user from past ` +
    `conversations (use naturally, don't just recite them):\n${lines}`
  );
}
