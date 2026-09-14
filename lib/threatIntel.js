import { getDb } from "@/lib/db";

// Cyber threat intelligence reference library: a small, curated, growing
// knowledge base of things Lain should be able to cite when acting as a
// security/forensics analyst — kill chain phases, ATT&CK-style techniques,
// IOCs, mitigations, whatever's worth having on hand for quick lookup
// instead of relying purely on the model's own (unsourced, sometimes
// stale) training knowledge. Seeded/curated by the user via the Threat
// Intel admin panel; queried by Lain via the lookup_threat_intel tool.
//
// Full-text search (SQLite FTS5) over title/content/tags — good enough for
// this use case (structured reference entries, not free-form documents) and
// needs no embedding model or vector store.
const MAX_SEARCH_RESULTS = 8;
const MAX_LIST_RESULTS = 200;

/** Adds a new reference entry. Returns the created row. */
export function addThreatIntel({ category, title, content, tags }) {
  const cat = String(category || "").trim();
  const t = String(title || "").trim();
  const c = String(content || "").trim();
  if (!cat) throw new Error("category is required");
  if (!t) throw new Error("title is required");
  if (!c) throw new Error("content is required");
  const tagsStr = Array.isArray(tags) ? tags.join(", ") : String(tags || "").trim();
  const db = getDb();
  const info = db
    .prepare(
      `INSERT INTO threat_intel (category, title, content, tags, created_at) VALUES (?, ?, ?, ?, ?)`
    )
    .run(cat, t, c, tagsStr, Date.now());
  return { id: info.lastInsertRowid, category: cat, title: t, content: c, tags: tagsStr };
}

/** Lists every reference entry, optionally filtered by category, most recent first. */
export function listThreatIntel(category = null) {
  const db = getDb();
  if (category) {
    return db
      .prepare(
        `SELECT * FROM threat_intel WHERE category = ? ORDER BY created_at DESC LIMIT ?`
      )
      .all(category, MAX_LIST_RESULTS);
  }
  return db
    .prepare(`SELECT * FROM threat_intel ORDER BY category, created_at DESC LIMIT ?`)
    .all(MAX_LIST_RESULTS);
}

/** Distinct categories currently in use, for grouping in the admin panel. */
export function listThreatIntelCategories() {
  const db = getDb();
  return db
    .prepare(`SELECT DISTINCT category FROM threat_intel ORDER BY category`)
    .all()
    .map((r) => r.category);
}

/** Deletes a reference entry by id. Returns true if a row was removed. */
export function deleteThreatIntel(id) {
  const db = getDb();
  const info = db.prepare(`DELETE FROM threat_intel WHERE id = ?`).run(id);
  return info.changes > 0;
}

/**
 * Full-text search over the reference library — used by the
 * lookup_threat_intel tool. Returns the matching rows (category, title,
 * content, tags), best matches first.
 */
export function searchThreatIntel(query, limit = MAX_SEARCH_RESULTS) {
  const q = String(query || "").trim();
  if (!q) return [];
  const db = getDb();
  // FTS5 special characters (", *, etc.) in free-text queries can throw a
  // syntax error — quote each token and OR them together so any word in the
  // query can match, robust to punctuation/typos in what the model sends.
  const ftsQuery = q
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => `"${word.replace(/"/g, '""')}"`)
    .join(" OR ");
  if (!ftsQuery) return [];
  try {
    return db
      .prepare(
        `SELECT t.id, t.category, t.title, t.content, t.tags
         FROM threat_intel_fts f
         JOIN threat_intel t ON t.id = f.rowid
         WHERE threat_intel_fts MATCH ?
         ORDER BY bm25(threat_intel_fts)
         LIMIT ?`
      )
      .all(ftsQuery, Math.min(Number(limit) || MAX_SEARCH_RESULTS, 25));
  } catch {
    // Fall back to a plain substring scan if the FTS query still fails for
    // some reason — better a slower match than an error surfaced to the model.
    const like = `%${q}%`;
    return db
      .prepare(
        `SELECT id, category, title, content, tags FROM threat_intel
         WHERE title LIKE ? OR content LIKE ? OR tags LIKE ?
         ORDER BY created_at DESC LIMIT ?`
      )
      .all(like, like, like, Math.min(Number(limit) || MAX_SEARCH_RESULTS, 25));
  }
}
