import { randomUUID } from "node:crypto";
import { getDb } from "./db";
import { callOllama } from "./ollama";

// Hard cap on raw messages ever pulled from the DB per request — a safety
// net under the token-budget trim below. Lowered from 40 -> 24: verbose
// tool-narration replies (observed at 1000-1800 chars each) meant even 32
// messages could bloat a single request's real prompt tokens well past
// what the model handles tool-calling reliably at (see CONTEXT_WARNING_
// TOKENS in lib/ollama.js).
const HISTORY_LIMIT = Number(process.env.LAIN_HISTORY_LIMIT || 24);
// Rough chars-per-token estimate (no real tokenizer available client-side)
// used to trim history by actual verbosity instead of a flat message
// count, since a handful of long narrated replies can cost as much as
// dozens of short ones.
const HISTORY_TOKEN_BUDGET = Number(process.env.LAIN_HISTORY_TOKEN_BUDGET || 6000);
// Always keep at least this many most-recent messages verbatim, even if
// that alone exceeds the token budget — the current back-and-forth needs
// to stay intact for the model to make sense of the latest turn.
const MIN_KEEP_MESSAGES = Number(process.env.LAIN_HISTORY_MIN_KEEP || 6);
function estimateTokens(text) {
  return Math.ceil((text || "").length / 4);
}

// Once a conversation's raw (not-yet-summarized) history grows past this
// many messages, fold everything older than KEEP_RECENT_MESSAGES down
// into a short recap (see maybeCompactHistory) instead of sending it all,
// verbatim, on every subsequent turn forever.
const KEEP_RECENT_MESSAGES = Number(process.env.LAIN_HISTORY_KEEP_RECENT || 12);
const COMPACT_TRIGGER_MESSAGES = KEEP_RECENT_MESSAGES + 10;
// Cap how much transcript gets fed in for a single compaction pass.
const MAX_COMPACT_TRANSCRIPT_CHARS = 12000;

const COMPACT_SYSTEM_PROMPT = `You are condensing the older portion of an
ongoing chat between Lain (an AI assistant) and her user into a short,
factual recap for Lain's own later reference in this same conversation.

Write a few short sentences or terse bullet points (no headers, no
narrative flourish). Preserve concrete facts: hosts/IPs/CVEs/hashes
investigated and their findings, anything saved to threat intel or notes,
decisions made, and open threads. Skip small talk and personality color.
If an earlier recap is given, merge it with the new material into one
updated recap rather than just appending.`;

export function ensureConversation(conversationId, title) {
  const db = getDb();
  if (conversationId) {
    const row = db
      .prepare("SELECT id FROM conversations WHERE id = ?")
      .get(conversationId);
    if (row) return conversationId;
  }
  const newId = randomUUID();
  const clean = title ? String(title).trim().slice(0, 100) : "";
  db.prepare(
    "INSERT INTO conversations (id, title, created_at) VALUES (?, ?, ?)"
  ).run(newId, clean || "New chat", Date.now() / 1000);
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
  const convo = db
    .prepare(
      "SELECT history_summary, history_summary_through_id FROM conversations WHERE id = ?"
    )
    .get(conversationId);
  const afterId = convo?.history_summary_through_id || 0;

  const rows = db
    .prepare(
      "SELECT id, role, content FROM messages WHERE conversation_id = ? AND id > ? ORDER BY id DESC LIMIT ?"
    )
    .all(conversationId, afterId, limit);

  // Token-budget trim: even within the (already summary-shortened) window,
  // a handful of very verbose recent turns can still add up — drop
  // oldest-first until under budget, but always keep at least the last
  // MIN_KEEP_MESSAGES so context is never gutted entirely.
  let trimmed = rows.reverse();
  let total = trimmed.reduce((sum, r) => sum + estimateTokens(r.content), 0);
  while (trimmed.length > MIN_KEEP_MESSAGES && total > HISTORY_TOKEN_BUDGET) {
    total -= estimateTokens(trimmed[0].content);
    trimmed = trimmed.slice(1);
  }

  const messages = trimmed.map((r) => ({
    role: r.role,
    content:
      r.role === "assistant" ? r.content.replace(TOOL_SUMMARY_PREFIX_RE, "") : r.content,
  }));

  if (convo?.history_summary) {
    messages.unshift({
      role: "system",
      content:
        "Recap of earlier parts of this same conversation (for your own " +
        "context — don't recite this verbatim or announce you're " +
        `"recalling" it):\n${convo.history_summary}`,
    });
  }

  return messages;
}

// Folds older messages into a short recap once a conversation's raw
// history gets long, so subsequent turns don't keep re-sending dozens of
// (often verbose) past exchanges in full. Fire-and-forget from the chat
// routes — never awaited inline, so it can't add latency to a live reply;
// errors are swallowed since this is a best-effort optimization, not a
// correctness requirement (loadHistory works fine with no summary at all).
export async function maybeCompactHistory(conversationId) {
  const db = getDb();
  const convo = db
    .prepare(
      "SELECT history_summary, history_summary_through_id FROM conversations WHERE id = ?"
    )
    .get(conversationId);
  if (!convo) return;

  const afterId = convo.history_summary_through_id || 0;
  const uncovered = db
    .prepare(
      "SELECT id, role, content FROM messages WHERE conversation_id = ? AND id > ? ORDER BY id"
    )
    .all(conversationId, afterId);

  if (uncovered.length < COMPACT_TRIGGER_MESSAGES) return;

  const toSummarize = uncovered.slice(0, uncovered.length - KEEP_RECENT_MESSAGES);
  if (toSummarize.length === 0) return;

  const transcript = toSummarize
    .map((m) => `${m.role === "user" ? "User" : "Lain"}: ${m.content}`)
    .join("\n")
    .slice(-MAX_COMPACT_TRANSCRIPT_CHARS);

  const priorRecap = convo.history_summary
    ? `Earlier recap so far:\n${convo.history_summary}\n\n`
    : "";

  try {
    const data = await callOllama(
      [
        { role: "system", content: COMPACT_SYSTEM_PROMPT },
        { role: "user", content: `${priorRecap}New material to fold in:\n${transcript}` },
      ],
      false
    );
    const newSummary = (data.message?.content || "").trim();
    if (!newSummary) return;

    const throughId = toSummarize[toSummarize.length - 1].id;
    db.prepare(
      "UPDATE conversations SET history_summary = ?, history_summary_through_id = ? WHERE id = ?"
    ).run(newSummary, throughId, conversationId);
  } catch (err) {
    console.error(`[lain] history compaction failed for ${conversationId}:`, err.message);
  }
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
