// Playbook runs: a stateful, per-incident execution of a library playbook.
// Starting a run snapshots the playbook into ordered steps (so later edits
// to the library don't change a run in flight); each step then moves through
// pending → done/skipped/blocked with an optional note, every change is
// logged to the incident timeline, and the run completes itself once no
// step is left pending or blocked.
//
// Lain-only (not in the shared assistant-tools submodule). Takes the SQLite
// connection as `db`; the run tables are created by incidentCases.ensureSchema.
//
// Steps are guidance, not automation: marking one done records that it was
// carried out, it never performs anything. Anything that changes a system
// goes through the usual confirmation-gated tools.
const { splitPlaybookSections } = require("../tools-agent/shared/tools/playbooks");
const { logEvent } = require("./incidentCases");

const STEP_STATUSES = ["pending", "done", "skipped", "blocked"];
const MAX_STEPS = 100;
const MAX_STEP_CHARS = 1000;
const LIST_ITEM_RE = /^\s{0,3}(?:\d+[.)]|[-*•])\s+(.*\S)\s*$/;

function incidentExists(db, id) {
  return !!db.prepare(`SELECT id FROM incidents WHERE id = ?`).get(id);
}

/**
 * Splits playbook content into ordered steps. Each list item (numbered or
 * bulleted) under a "## Section" heading is a step; a section with no list
 * items becomes one step; continuation lines join the previous item.
 */
function parsePlaybookSteps(content) {
  const steps = [];
  for (const section of splitPlaybookSections(content)) {
    const items = [];
    for (const line of String(section.content || "").split("\n")) {
      const m = line.match(LIST_ITEM_RE);
      if (m) items.push(m[1].trim());
      else if (line.trim() && items.length) items[items.length - 1] += ` ${line.trim()}`;
      else if (line.trim()) items.push(line.trim());
    }
    for (const text of items) {
      steps.push({ section: section.title, text: text.slice(0, MAX_STEP_CHARS) });
    }
  }
  return steps.slice(0, MAX_STEPS);
}

function summarize(db, run) {
  const steps = db
    .prepare(`SELECT * FROM playbook_run_steps WHERE run_id = ? ORDER BY position`)
    .all(run.id);
  const finished = steps.filter((s) => s.status === "done" || s.status === "skipped").length;
  const next = steps.find((s) => s.status === "pending" || s.status === "blocked") || null;
  return { ...run, steps, progress: { finished, total: steps.length }, next_step: next };
}

function getRun(db, runId) {
  const run = db.prepare(`SELECT * FROM playbook_runs WHERE id = ?`).get(runId);
  return run ? summarize(db, run) : null;
}

/** The most recent still-active run on an incident, or null. */
function getActiveRun(db, incidentId) {
  const run = db
    .prepare(
      `SELECT * FROM playbook_runs WHERE incident_id = ? AND status = 'active'
       ORDER BY created_at DESC, id DESC LIMIT 1`
    )
    .get(incidentId);
  return run ? summarize(db, run) : null;
}

function listRuns(db, incidentId) {
  return db
    .prepare(`SELECT * FROM playbook_runs WHERE incident_id = ? ORDER BY created_at DESC, id DESC`)
    .all(incidentId)
    .map((run) => summarize(db, run));
}

/**
 * Starts a run of `playbookId` on an incident. If that playbook already has
 * an active run there, returns it (with `resumed: true`) instead of
 * duplicating. Returns null if the incident or playbook doesn't exist.
 */
function startRun(db, incidentId, playbookId, author = "") {
  if (!incidentExists(db, incidentId)) return null;
  const playbook = db.prepare(`SELECT * FROM playbooks WHERE id = ?`).get(playbookId);
  if (!playbook) return null;
  const existing = db
    .prepare(
      `SELECT * FROM playbook_runs WHERE incident_id = ? AND playbook_id = ? AND status = 'active'`
    )
    .get(incidentId, playbook.id);
  if (existing) return { ...summarize(db, existing), resumed: true };
  const steps = parsePlaybookSteps(playbook.content);
  if (!steps.length) throw new Error("That playbook has no steps to run.");
  const now = Date.now();
  const info = db
    .prepare(
      `INSERT INTO playbook_runs (incident_id, playbook_id, playbook_title, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?)`
    )
    .run(incidentId, playbook.id, playbook.title, now, now);
  const runId = Number(info.lastInsertRowid);
  const insert = db.prepare(
    `INSERT INTO playbook_run_steps (run_id, position, section, text, updated_at) VALUES (?, ?, ?, ?, ?)`
  );
  steps.forEach((s, i) => insert.run(runId, i + 1, s.section, s.text, now));
  db.prepare(`UPDATE incidents SET updated_at = ? WHERE id = ?`).run(now, incidentId);
  logEvent(
    db,
    incidentId,
    "action",
    `Started playbook run #${runId}: ${playbook.title} (${steps.length} steps)`,
    author
  );
  return getRun(db, runId);
}

/**
 * Sets a step's status/note. `step` is the 1-based position within the run.
 * Skipping or blocking a step requires a note explaining why. The run
 * completes automatically when nothing is left pending or blocked.
 */
function updateStep(db, runId, step, { status, note } = {}, author = "") {
  const run = db.prepare(`SELECT * FROM playbook_runs WHERE id = ?`).get(runId);
  if (!run) return null;
  if (run.status !== "active") throw new Error(`Run #${runId} is already ${run.status}.`);
  const row = db
    .prepare(`SELECT * FROM playbook_run_steps WHERE run_id = ? AND position = ?`)
    .get(runId, Number(step));
  if (!row) throw new Error(`Run #${runId} has no step ${step}.`);
  const newStatus = String(status || "").trim().toLowerCase();
  if (!STEP_STATUSES.includes(newStatus)) {
    throw new Error(`status must be one of: ${STEP_STATUSES.join(", ")}`);
  }
  const text = String(note ?? "").trim();
  if ((newStatus === "skipped" || newStatus === "blocked") && !text && !row.note) {
    throw new Error(`A note explaining why is required to mark a step ${newStatus}.`);
  }
  const now = Date.now();
  db.prepare(`UPDATE playbook_run_steps SET status = ?, note = ?, updated_at = ? WHERE id = ?`).run(
    newStatus,
    text || row.note,
    now,
    row.id
  );
  db.prepare(`UPDATE playbook_runs SET updated_at = ? WHERE id = ?`).run(now, runId);
  db.prepare(`UPDATE incidents SET updated_at = ? WHERE id = ?`).run(now, run.incident_id);
  if (newStatus !== row.status) {
    logEvent(
      db,
      run.incident_id,
      "action",
      `Playbook "${run.playbook_title}" step ${row.position} ${newStatus}: ${row.text.slice(0, 120)}` +
        (text ? ` — ${text}` : ""),
      author
    );
  }
  const updated = getRun(db, runId);
  if (!updated.next_step) return finishRun(db, runId, "completed", author) && getRun(db, runId);
  return updated;
}

/** Marks a run completed or abandoned. Returns false if not found or already finished. */
function finishRun(db, runId, status = "completed", author = "") {
  if (!["completed", "abandoned"].includes(status)) {
    throw new Error("status must be completed or abandoned");
  }
  const run = db.prepare(`SELECT * FROM playbook_runs WHERE id = ?`).get(runId);
  if (!run || run.status !== "active") return false;
  const now = Date.now();
  db.prepare(`UPDATE playbook_runs SET status = ?, completed_at = ?, updated_at = ? WHERE id = ?`).run(
    status,
    now,
    now,
    runId
  );
  logEvent(db, run.incident_id, "action", `Playbook run #${runId} ${status}: ${run.playbook_title}`, author);
  return true;
}

const toolDefinitions = {
  start_playbook_run: {
    name: "start_playbook_run",
    description:
      "Start a tracked, step-by-step run of a library playbook on an incident " +
      "case (defaults to this conversation's active incident). Get the " +
      "playbook_id from lookup_playbook. The playbook is snapshotted into " +
      "numbered steps whose progress is saved on the case. If that playbook " +
      "is already running on the case, returns the existing run. Prefer " +
      "this over start_incident_report whenever an incident case is active.",
    parameters: {
      type: "object",
      properties: {
        playbook_id: { type: "number", description: "id of the playbook (from lookup_playbook)." },
        incident_id: { type: "number", description: "Incident to run it on (default: active incident)." },
      },
      required: ["playbook_id"],
    },
  },
  get_playbook_run: {
    name: "get_playbook_run",
    description:
      "Show a playbook run's steps, statuses, and the next step to work on. " +
      "Defaults to the active incident's most recent active run.",
    parameters: {
      type: "object",
      properties: {
        run_id: { type: "number", description: "Run id (default: the active incident's active run)." },
        incident_id: { type: "number", description: "Incident to look in (default: active incident)." },
      },
    },
  },
  update_playbook_step: {
    name: "update_playbook_step",
    description:
      "Record progress on a playbook run step: done (it was actually " +
      "carried out or confirmed by the user), skipped (not applicable), " +
      "blocked (can't proceed), or pending (reopen). Skipped and blocked " +
      "need a note saying why. Each change is logged to the case timeline, " +
      "and the run completes automatically when no step is left pending or " +
      "blocked. Marking a step done only records it — it does not perform it.",
    parameters: {
      type: "object",
      properties: {
        step: { type: "number", description: "1-based step number within the run." },
        status: { type: "string", enum: STEP_STATUSES },
        note: { type: "string", description: "What was done/found, or why skipped/blocked." },
        run_id: { type: "number", description: "Run id (default: the active incident's active run)." },
        incident_id: { type: "number", description: "Incident to look in (default: active incident)." },
      },
      required: ["step", "status"],
    },
  },
};

const CONFIRM_REQUIRED_TOOLS = new Set();

function describeToolCall(name, args = {}) {
  switch (name) {
    case "start_playbook_run":
      return `start playbook #${args.playbook_id} on an incident`;
    case "get_playbook_run":
      return `view a playbook run`;
    case "update_playbook_step":
      return `mark playbook step ${args.step} ${args.status}`;
    default:
      return undefined;
  }
}

module.exports = {
  STEP_STATUSES,
  parsePlaybookSteps,
  startRun,
  getRun,
  getActiveRun,
  listRuns,
  updateStep,
  finishRun,
  toolDefinitions,
  CONFIRM_REQUIRED_TOOLS,
  describeToolCall,
};
