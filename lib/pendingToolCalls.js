// In-memory store for tool calls awaiting the user's approval in the chat
// UI. Short-lived by design (cleared on use or after TTL) — this is a
// confirmation handshake, not conversation state, so it doesn't need to
// survive a container restart.

import { randomUUID } from "node:crypto";

const PENDING = new Map();
const TTL_MS = 10 * 60 * 1000; // 10 minutes

export function createPending(data) {
  cleanup();
  const id = randomUUID();
  PENDING.set(id, { ...data, createdAt: Date.now() });
  return id;
}

export function getPending(id) {
  cleanup();
  return PENDING.get(id);
}

export function deletePending(id) {
  PENDING.delete(id);
}

function cleanup() {
  const now = Date.now();
  for (const [id, entry] of PENDING) {
    if (now - entry.createdAt > TTL_MS) PENDING.delete(id);
  }
}
