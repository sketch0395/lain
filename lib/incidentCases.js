// Incident cases: the first-class "case" object for incident response.
// Where incidentReports.js is the finished write-up of what happened (and
// its per-conversation live draft), an incident here is the durable case
// that everything else hangs off: severity/status/phase, an append-only
// timeline of events, and links to the conversations (and saved reports)
// that worked on it. One conversation can be linked to several incidents
// and vice versa; the "active" incident for a conversation is the most
// recently updated non-closed one linked to it.
//
// Framework-agnostic like the other tools/*.js modules here: the host
// owns its own SQLite connection and passes it in as `db`.
const SEVERITIES = ["low", "medium", "high", "critical"];
const STATUSES = ["open", "investigating", "contained", "resolved", "closed"];
const PHASES = ["triage", "containment", "eradication", "recovery", "review"];
const EVENT_TYPES = ["note", "finding", "action"];
const LINK_KINDS = ["conversation", "report"];
const TERMINAL_STATUSES = ["resolved", "closed"];
// Present in the system prompt only while a conversation has an active
// incident; lib/ollama.js keys off it to keep the incident tools available
// even when the user's latest message has no incident keywords.
const ACTIVE_INCIDENT_MARKER = "ACTIVE INCIDENT for this conversation";
const MAX_LIST_RESULTS = 200;
const MAX_TIMELINE_EVENTS = 500;

function ensureSchema(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS incidents (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      severity TEXT NOT NULL DEFAULT 'medium',
      status TEXT NOT NULL DEFAULT 'open',
      phase TEXT NOT NULL DEFAULT 'triage',
      category TEXT NOT NULL DEFAULT '',
      owner TEXT NOT NULL DEFAULT '',
      summary TEXT NOT NULL DEFAULT '',
      created_at REAL,
      updated_at REAL,
      closed_at REAL
    );
    CREATE TABLE IF NOT EXISTS incident_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      incident_id INTEGER NOT NULL,
      type TEXT NOT NULL,
      content TEXT NOT NULL,
      author TEXT NOT NULL DEFAULT '',
      created_at REAL,
      FOREIGN KEY (incident_id) REFERENCES incidents (id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_incident_events_incident
      ON incident_events (incident_id, created_at);
    CREATE TABLE IF NOT EXISTS incident_links (
      incident_id INTEGER NOT NULL,
      kind TEXT NOT NULL,
      ref TEXT NOT NULL,
      created_at REAL,
      PRIMARY KEY (incident_id, kind, ref),
      FOREIGN KEY (incident_id) REFERENCES incidents (id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_incident_links_ref
      ON incident_links (kind, ref);
    CREATE TABLE IF NOT EXISTS incident_iocs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      incident_id INTEGER NOT NULL,
      type TEXT NOT NULL,
      value TEXT NOT NULL,
      source TEXT NOT NULL DEFAULT '',
      verdict TEXT NOT NULL DEFAULT 'unknown',
      confidence INTEGER,
      summary TEXT NOT NULL DEFAULT '',
      enrichment TEXT,
      enriched_at REAL,
      locked INTEGER NOT NULL DEFAULT 0,
      notes TEXT NOT NULL DEFAULT '',
      first_seen REAL,
      last_seen REAL,
      UNIQUE (incident_id, type, value),
      FOREIGN KEY (incident_id) REFERENCES incidents (id) ON DELETE CASCADE
    );
  `);
}

function pickEnum(value, allowed, fallback, label) {
  if (value === undefined || value === null || value === "") return fallback;
  const v = String(value).trim().toLowerCase();
  if (!allowed.includes(v)) {
    throw new Error(`${label} must be one of: ${allowed.join(", ")}`);
  }
  return v;
}

function addEvent(db, incidentId, type, content, author = "") {
  const now = Date.now();
  const info = db
    .prepare(
      `INSERT INTO incident_events (incident_id, type, content, author, created_at)
       VALUES (?, ?, ?, ?, ?)`
    )
    .run(incidentId, type, String(content), String(author || ""), now);
  return { id: Number(info.lastInsertRowid), incident_id: incidentId, type, content, author, created_at: now };
}

function linkRef(db, incidentId, kind, ref) {
  if (!LINK_KINDS.includes(kind)) throw new Error(`unknown link kind: ${kind}`);
  const info = db
    .prepare(
      `INSERT OR IGNORE INTO incident_links (incident_id, kind, ref, created_at)
       VALUES (?, ?, ?, ?)`
    )
    .run(incidentId, kind, String(ref), Date.now());
  return info.changes > 0;
}

/** Opens a new incident, optionally linking the conversation that opened it. */
function createIncident(
  db,
  { title, severity, category, owner, summary, conversationId } = {}
) {
  const t = String(title || "").trim();
  if (!t) throw new Error("title is required");
  const sev = pickEnum(severity, SEVERITIES, "medium", "severity");
  const now = Date.now();
  const info = db
    .prepare(
      `INSERT INTO incidents (title, severity, status, phase, category, owner, summary, created_at, updated_at)
       VALUES (?, ?, 'open', 'triage', ?, ?, ?, ?, ?)`
    )
    .run(
      t,
      sev,
      String(category || "").trim(),
      String(owner || "").trim(),
      String(summary || "").trim(),
      now,
      now
    );
  const id = Number(info.lastInsertRowid);
  addEvent(db, id, "created", `Incident opened (severity: ${sev}).`);
  if (conversationId) linkRef(db, id, "conversation", conversationId);
  return getIncident(db, id);
}

/** Lists incidents (newest activity first) with timeline/link counts. */
function listIncidents(db, { status, includeClosed = true, limit } = {}) {
  const where = [];
  const params = [];
  if (status) {
    where.push("i.status = ?");
    params.push(pickEnum(status, STATUSES, null, "status"));
  } else if (!includeClosed) {
    where.push("i.status != 'closed'");
  }
  const cap = Math.min(Math.max(Number(limit) || MAX_LIST_RESULTS, 1), MAX_LIST_RESULTS);
  return db
    .prepare(
      `SELECT i.*,
         (SELECT COUNT(*) FROM incident_events e WHERE e.incident_id = i.id) AS event_count,
         (SELECT COUNT(*) FROM incident_links l WHERE l.incident_id = i.id AND l.kind = 'conversation') AS conversation_count,
         (SELECT COUNT(*) FROM incident_iocs c WHERE c.incident_id = i.id) AS ioc_count
       FROM incidents i
       ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
       ORDER BY i.updated_at DESC
       LIMIT ?`
    )
    .all(...params, cap);
}

/** Returns the incident with its timeline (oldest first) and links, or null. */
function getIncident(db, id) {
  const incident = db.prepare(`SELECT * FROM incidents WHERE id = ?`).get(id);
  if (!incident) return null;
  const events = db
    .prepare(
      `SELECT * FROM incident_events WHERE incident_id = ?
       ORDER BY created_at ASC, id ASC LIMIT ?`
    )
    .all(id, MAX_TIMELINE_EVENTS);
  const links = db
    .prepare(`SELECT kind, ref, created_at FROM incident_links WHERE incident_id = ? ORDER BY created_at`)
    .all(id);
  const iocs = db
    .prepare(`SELECT * FROM incident_iocs WHERE incident_id = ? ORDER BY first_seen ASC, id ASC LIMIT 500`)
    .all(id);
  return { ...incident, events, links, iocs };
}

/** Updates fields on an incident, logging each status/severity/phase change to the timeline. */
function updateIncident(
  db,
  id,
  { title, severity, status, phase, category, owner, summary } = {},
  author = ""
) {
  const existing = db.prepare(`SELECT * FROM incidents WHERE id = ?`).get(id);
  if (!existing) return null;

  const next = {
    title: title !== undefined ? String(title || "").trim() : existing.title,
    severity: pickEnum(severity, SEVERITIES, existing.severity, "severity"),
    status: pickEnum(status, STATUSES, existing.status, "status"),
    phase: pickEnum(phase, PHASES, existing.phase, "phase"),
    category: category !== undefined ? String(category || "").trim() : existing.category,
    owner: owner !== undefined ? String(owner || "").trim() : existing.owner,
    summary: summary !== undefined ? String(summary || "").trim() : existing.summary,
  };
  if (!next.title) throw new Error("title is required");

  const now = Date.now();
  let closedAt = existing.closed_at;
  if (TERMINAL_STATUSES.includes(next.status)) {
    if (!TERMINAL_STATUSES.includes(existing.status)) closedAt = now;
  } else {
    closedAt = null;
  }

  db.prepare(
    `UPDATE incidents SET title = ?, severity = ?, status = ?, phase = ?, category = ?,
       owner = ?, summary = ?, updated_at = ?, closed_at = ? WHERE id = ?`
  ).run(
    next.title,
    next.severity,
    next.status,
    next.phase,
    next.category,
    next.owner,
    next.summary,
    now,
    closedAt,
    id
  );

  for (const field of ["status", "severity", "phase", "owner"]) {
    if (next[field] !== existing[field]) {
      addEvent(
        db,
        id,
        `${field}_change`,
        `${field} changed: ${existing[field] || "(none)"} → ${next[field] || "(none)"}`,
        author
      );
    }
  }
  return getIncident(db, id);
}

function deleteIncident(db, id) {
  db.prepare(`DELETE FROM incident_events WHERE incident_id = ?`).run(id);
  db.prepare(`DELETE FROM incident_links WHERE incident_id = ?`).run(id);
  db.prepare(`DELETE FROM incident_iocs WHERE incident_id = ?`).run(id);
  return db.prepare(`DELETE FROM incidents WHERE id = ?`).run(id).changes > 0;
}

/** Appends a note/finding/action to an incident's timeline. Returns the event, or null if no such incident. */
function addIncidentEvent(db, id, { type, content, author } = {}) {
  const c = String(content || "").trim();
  if (!c) throw new Error("content is required");
  const t = pickEnum(type, EVENT_TYPES, "note", "type");
  const exists = db.prepare(`SELECT id FROM incidents WHERE id = ?`).get(id);
  if (!exists) return null;
  const event = addEvent(db, id, t, c, author);
  db.prepare(`UPDATE incidents SET updated_at = ? WHERE id = ?`).run(event.created_at, id);
  return event;
}

/** Links a conversation to an incident (idempotent). Returns the incident, or null. */
function linkConversation(db, id, conversationId) {
  if (!conversationId) throw new Error("conversationId is required");
  const exists = db.prepare(`SELECT id FROM incidents WHERE id = ?`).get(id);
  if (!exists) return null;
  if (linkRef(db, id, "conversation", conversationId)) {
    addEvent(db, id, "link", `Conversation linked: ${conversationId}`);
  }
  return getIncident(db, id);
}

/** Links a saved incident report to an incident (idempotent). Returns the incident, or null. */
function linkReport(db, id, reportId) {
  const exists = db.prepare(`SELECT id FROM incidents WHERE id = ?`).get(id);
  if (!exists) return null;
  if (linkRef(db, id, "report", reportId)) {
    addEvent(db, id, "link", `Incident report #${reportId} linked.`);
  }
  return getIncident(db, id);
}

/** Most recently updated non-closed incident linked to this conversation, or null. */
function getActiveIncidentForConversation(db, conversationId) {
  if (!conversationId) return null;
  const row = db
    .prepare(
      `SELECT i.id FROM incidents i
       JOIN incident_links l ON l.incident_id = i.id
       WHERE l.kind = 'conversation' AND l.ref = ? AND i.status NOT IN ('resolved', 'closed')
       ORDER BY i.updated_at DESC LIMIT 1`
    )
    .get(String(conversationId));
  return row ? getIncident(db, row.id) : null;
}

/** Incidents a conversation is linked to (any status), for UI display. */
function listIncidentsForConversation(db, conversationId) {
  return db
    .prepare(
      `SELECT i.id, i.title, i.severity, i.status FROM incidents i
       JOIN incident_links l ON l.incident_id = i.id
       WHERE l.kind = 'conversation' AND l.ref = ?
       ORDER BY i.updated_at DESC`
    )
    .all(String(conversationId));
}

/**
 * Short system-prompt block describing the conversation's active incident
 * (empty string if none), so the model always has case context.
 */
function incidentContextAddendum(incident) {
  if (!incident) return "";
  const recent = incident.events
    .filter((e) => ["note", "finding", "action"].includes(e.type))
    .slice(-8)
    .map((e) => `- [${e.type}] ${e.content}`)
    .join("\n");
  return (
    `\n\n${ACTIVE_INCIDENT_MARKER} — #${incident.id}: ${incident.title}\n` +
    `Severity: ${incident.severity} | Status: ${incident.status} | Phase: ${incident.phase}` +
    (incident.category ? ` | Category: ${incident.category}` : "") +
    (incident.owner ? ` | Owner: ${incident.owner}` : "") +
    (incident.summary ? `\nSummary: ${incident.summary}` : "") +
    (recent ? `\nRecent timeline:\n${recent}` : "") +
    iocLine(incident) +
    `\nTreat everything in this conversation as part of this case: record findings and ` +
    `actions with add_incident_note, and keep status/phase current with update_incident.`
  );
}

function iocLine(incident) {
  const iocs = incident.iocs || [];
  if (!iocs.length) return "";
  const bad = iocs
    .filter((i) => i.verdict === "malicious" || i.verdict === "suspicious")
    .slice(0, 8)
    .map((i) => `${i.value} (${i.verdict})`);
  return (
    `\nIOCs tracked: ${iocs.length}` +
    (bad.length ? ` — flagged: ${bad.join(", ")}` : "")
  );
}

const toolDefinitions = {
  open_incident: {
    name: "open_incident",
    description:
      "Open a new incident case and link it to this conversation. Use when " +
      "the user reports or suspects a real security incident (or asks to " +
      "open/start a case). Check list_incidents first if one may already " +
      "exist for this issue, so you don't open a duplicate.",
    parameters: {
      type: "object",
      properties: {
        title: { type: "string", description: "Short descriptive case title." },
        severity: { type: "string", enum: SEVERITIES, description: "Initial severity (default medium)." },
        category: { type: "string", description: "Incident type, e.g. 'phishing', 'ransomware'." },
        summary: { type: "string", description: "What happened / how it was detected." },
        owner: { type: "string", description: "Who is leading the response, if known." },
      },
      required: ["title"],
    },
  },
  update_incident: {
    name: "update_incident",
    description:
      "Change an incident's severity, status, phase, owner, category, title, " +
      "or summary. Defaults to this conversation's active incident if " +
      "incident_id is omitted. Each status/severity/phase change is " +
      "recorded on the timeline automatically.",
    parameters: {
      type: "object",
      properties: {
        incident_id: { type: "number", description: "Incident to update (default: active incident)." },
        severity: { type: "string", enum: SEVERITIES },
        status: { type: "string", enum: STATUSES },
        phase: { type: "string", enum: PHASES },
        owner: { type: "string" },
        category: { type: "string" },
        title: { type: "string" },
        summary: { type: "string" },
      },
    },
  },
  add_incident_note: {
    name: "add_incident_note",
    description:
      "Append an entry to an incident's timeline as things happen: a " +
      "'finding' (evidence/IOC/observation), an 'action' (containment/" +
      "remediation taken), or a plain 'note'. Defaults to this " +
      "conversation's active incident if incident_id is omitted. One clear, " +
      "self-contained sentence per entry.",
    parameters: {
      type: "object",
      properties: {
        content: { type: "string", description: "What happened or was found." },
        type: { type: "string", enum: EVENT_TYPES, description: "Default 'note'." },
        incident_id: { type: "number", description: "Incident to add to (default: active incident)." },
        author: { type: "string", description: "Who did/found this, if relevant." },
      },
      required: ["content"],
    },
  },
  list_incidents: {
    name: "list_incidents",
    description:
      "List incident cases (newest activity first), optionally filtered by " +
      "status. Use to check whether a case already exists or to give the " +
      "user an overview of open incidents.",
    parameters: {
      type: "object",
      properties: {
        status: { type: "string", enum: STATUSES, description: "Only incidents with this status." },
        include_closed: { type: "boolean", description: "Include closed incidents (default true)." },
      },
    },
  },
  get_incident: {
    name: "get_incident",
    description:
      "Get one incident with its full timeline and links. Defaults to this " +
      "conversation's active incident if incident_id is omitted.",
    parameters: {
      type: "object",
      properties: {
        incident_id: { type: "number", description: "Incident to fetch (default: active incident)." },
      },
    },
  },
};

// open_incident/update_incident create or change a persistent case record,
// so they go through the normal confirm/deny flow. add_incident_note is
// append-only to the timeline (same reasoning as log_incident_entry) and
// list/get are read-only, so those run immediately.
const CONFIRM_REQUIRED_TOOLS = ["open_incident", "update_incident"];

function describeToolCall(name, args = {}) {
  switch (name) {
    case "open_incident":
      return `open an incident case: "${args.title}"${args.severity ? ` (${args.severity})` : ""}`;
    case "update_incident": {
      const changes = ["severity", "status", "phase", "owner", "category", "title", "summary"]
        .filter((k) => args[k] !== undefined)
        .map((k) => `${k}=${String(args[k]).slice(0, 40)}`)
        .join(", ");
      return `update incident ${args.incident_id ? `#${args.incident_id}` : "(active)"}${changes ? `: ${changes}` : ""}`;
    }
    case "add_incident_note":
      return `add an incident ${args.type || "note"}`;
    case "list_incidents":
      return `list incident cases`;
    case "get_incident":
      return `view an incident case`;
    default:
      return undefined;
  }
}

module.exports = {
  SEVERITIES,
  STATUSES,
  PHASES,
  EVENT_TYPES,
  ACTIVE_INCIDENT_MARKER,
  ensureSchema,
  createIncident,
  listIncidents,
  getIncident,
  updateIncident,
  deleteIncident,
  addIncidentEvent,
  logEvent: addEvent,
  linkConversation,
  linkReport,
  getActiveIncidentForConversation,
  listIncidentsForConversation,
  incidentContextAddendum,
  toolDefinitions,
  CONFIRM_REQUIRED_TOOLS,
  describeToolCall,
};
