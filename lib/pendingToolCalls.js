// Store for tool calls awaiting the user's approval in the chat UI —
// persisted to SQLite (not just in-memory) so a redeploy or restart between
// the model proposing a tool call and the user clicking Approve/Deny
// doesn't just silently drop it. It's still short-lived by design (a
// confirmation handshake, not real conversation state): entries older than
// TTL_MS are cleaned up lazily on each read/write.

import { randomUUID } from "node:crypto";
import { getDb } from "./db";

const TTL_MS = 10 * 60 * 1000; // 10 minutes

export function createPending(data) {
  cleanup();
  const id = randomUUID();
  getDb()
    .prepare("INSERT INTO pending_tool_calls (id, data, created_at) VALUES (?, ?, ?)")
    .run(id, JSON.stringify(data), Date.now());
  return id;
}

export function getPending(id) {
  cleanup();
  const row = getDb()
    .prepare("SELECT data FROM pending_tool_calls WHERE id = ?")
    .get(id);
  return row ? JSON.parse(row.data) : undefined;
}

export function deletePending(id) {
  getDb().prepare("DELETE FROM pending_tool_calls WHERE id = ?").run(id);
}

function cleanup() {
  getDb()
    .prepare("DELETE FROM pending_tool_calls WHERE created_at < ?")
    .run(Date.now() - TTL_MS);
}
