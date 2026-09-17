// Reminder/cron-style scheduling. Reminders are created either via chat (the
// model calls the create_reminder tool) or the Reminders management panel in
// the web UI, and fired by lib/scheduler.js, which polls for due reminders
// and hands them to lib/notify.js.
//
// Two scheduling modes are supported:
//   - Simple: `repeat` is one of once/daily/weekly/weekdays, `next_run` is
//     advanced with plain date arithmetic.
//   - Cron: `repeat` is "cron" and `cron_expr` holds a standard 5-field cron
//     expression (e.g. "0 9 * * 1-5"), advanced via cron-parser. This is what
//     powers "custom" schedules from the management UI.
//
// `run_at`/`next_run` are stored as epoch-ms and interpreted in
// LAIN_TIMEZONE (set alongside TZ — see docker-compose.yml) so relative
// phrases like "in 30 minutes" or "every day at 9am", and cron expressions,
// behave the way the user actually expects.

import { randomUUID } from "node:crypto";
import { CronExpressionParser } from "cron-parser";
import { getDb } from "./db";
import { parseEmailList } from "./email";

const REPEATS = new Set(["once", "daily", "weekly", "weekdays", "cron"]);
const TZ = process.env.LAIN_TIMEZONE || "America/Chicago";

function parseLocalDateTime(str) {
  const d = new Date(str);
  if (isNaN(d.getTime())) {
    throw new Error(`Invalid date/time: "${str}"`);
  }
  return d;
}

function addDays(date, n) {
  const d = new Date(date);
  d.setDate(d.getDate() + n);
  return d;
}

function nextWeekday(date) {
  let d = addDays(date, 1);
  while (d.getDay() === 0 || d.getDay() === 6) d = addDays(d, 1);
  return d;
}

/** Throws a friendly error if `expr` isn't a valid 5-field cron expression. */
export function validateCronExpr(expr) {
  try {
    CronExpressionParser.parse(expr, { tz: TZ });
  } catch (err) {
    throw new Error(`Invalid cron expression "${expr}": ${err.message}`);
  }
}

function nextCronRun(expr, fromDate) {
  const interval = CronExpressionParser.parse(expr, {
    currentDate: fromDate,
    tz: TZ,
  });
  return interval.next().toDate();
}

export function createReminder({
  title,
  message,
  action,
  repeat,
  run_at,
  cron_expr,
  email_to,
  conversationId,
}) {
  const db = getDb();
  const isCron = repeat === "cron" || Boolean(cron_expr);
  let firstRun;

  if (isCron) {
    if (!cron_expr) throw new Error("cron_expr is required when repeat is 'cron'");
    validateCronExpr(cron_expr);
    firstRun = nextCronRun(cron_expr, new Date());
  } else {
    if (!run_at) throw new Error("run_at is required");
    firstRun = parseLocalDateTime(run_at);
  }

  // Validate now so bad addresses are rejected at creation time, not silently
  // dropped when the reminder fires.
  const emailList = email_to ? parseEmailList(email_to) : [];

  const row = {
    id: randomUUID(),
    title: (title || "Reminder").slice(0, 200),
    message: (message || "").slice(0, 2000),
    action: action === "news" ? "news" : action === "digest" ? "digest" : "notify",
    repeat: isCron ? "cron" : REPEATS.has(repeat) ? repeat : "once",
    next_run: firstRun.getTime(),
    enabled: 1,
    created_at: Date.now(),
    conversation_id: conversationId || null,
    cron_expr: isCron ? cron_expr : null,
    email_to: emailList.length ? emailList.join(", ") : null,
  };
  db.prepare(
    `INSERT INTO reminders (id, title, message, action, repeat, next_run, enabled, created_at, conversation_id, cron_expr, email_to)
     VALUES (@id, @title, @message, @action, @repeat, @next_run, @enabled, @created_at, @conversation_id, @cron_expr, @email_to)`
  ).run(row);
  return {
    id: row.id,
    title: row.title,
    action: row.action,
    repeat: row.repeat,
    cron_expr: row.cron_expr,
    email_to: row.email_to,
    next_run: new Date(row.next_run).toISOString(),
  };
}

/** Active reminders only — used by the chat tool (list_reminders). */
export function listReminders() {
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT id, title, message, action, repeat, next_run, cron_expr, email_to FROM reminders
       WHERE enabled = 1 ORDER BY next_run ASC`
    )
    .all();
  return rows.map((r) => ({ ...r, next_run: new Date(r.next_run).toISOString() }));
}

/** All reminders (active + cancelled) — used by the web Reminders management panel. */
export function getAllReminders() {
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT id, title, message, action, repeat, next_run, enabled, created_at, cron_expr, email_to
       FROM reminders ORDER BY enabled DESC, next_run ASC`
    )
    .all();
  return rows.map((r) => ({
    ...r,
    next_run: new Date(r.next_run).toISOString(),
    created_at: r.created_at ? new Date(r.created_at).toISOString() : null,
    enabled: Boolean(r.enabled),
  }));
}

export function cancelReminder(idOrTitle) {
  const db = getDb();
  if (!idOrTitle) return { cancelled: false, error: "id or title is required" };

  const byId = db
    .prepare(`UPDATE reminders SET enabled = 0 WHERE id = ? AND enabled = 1`)
    .run(idOrTitle);
  if (byId.changes > 0) return { cancelled: true, id: idOrTitle };

  const match = db
    .prepare(`SELECT id, title FROM reminders WHERE enabled = 1 AND title LIKE ? LIMIT 1`)
    .get(`%${idOrTitle}%`);
  if (!match) return { cancelled: false, error: `No matching reminder found for "${idOrTitle}".` };

  db.prepare(`UPDATE reminders SET enabled = 0 WHERE id = ?`).run(match.id);
  return { cancelled: true, id: match.id, title: match.title };
}

/** Hard-deletes a reminder by id (used by the management panel's Delete button). */
export function deleteReminder(id) {
  const db = getDb();
  const res = db.prepare(`DELETE FROM reminders WHERE id = ?`).run(id);
  return { deleted: res.changes > 0 };
}

/**
 * Updates an existing reminder's fields (management panel edit form).
 * Recomputes `next_run` if the schedule (run_at/cron_expr/repeat) changed.
 */
export function updateReminder(id, fields) {
  const db = getDb();
  const existing = db.prepare(`SELECT * FROM reminders WHERE id = ?`).get(id);
  if (!existing) throw new Error(`Reminder "${id}" not found`);

  const next = {
    title: fields.title !== undefined ? String(fields.title).slice(0, 200) : existing.title,
    message:
      fields.message !== undefined ? String(fields.message).slice(0, 2000) : existing.message,
    action:
      fields.action === "news"
        ? "news"
        : fields.action === "digest"
        ? "digest"
        : fields.action === "notify"
        ? "notify"
        : existing.action,
    enabled: fields.enabled !== undefined ? (fields.enabled ? 1 : 0) : existing.enabled,
    email_to:
      fields.email_to !== undefined
        ? (() => {
            const list = parseEmailList(fields.email_to);
            return list.length ? list.join(", ") : null;
          })()
        : existing.email_to,
  };

  let repeat = existing.repeat;
  let cron_expr = existing.cron_expr;
  let next_run = existing.next_run;
  const scheduleChanged =
    fields.repeat !== undefined || fields.cron_expr !== undefined || fields.run_at !== undefined;

  if (scheduleChanged) {
    const wantsCron = (fields.repeat ?? existing.repeat) === "cron" || Boolean(fields.cron_expr);
    if (wantsCron) {
      cron_expr = fields.cron_expr ?? existing.cron_expr;
      if (!cron_expr) throw new Error("cron_expr is required when repeat is 'cron'");
      validateCronExpr(cron_expr);
      repeat = "cron";
      next_run = nextCronRun(cron_expr, new Date()).getTime();
    } else {
      repeat = REPEATS.has(fields.repeat) ? fields.repeat : existing.repeat;
      cron_expr = null;
      if (fields.run_at) {
        next_run = parseLocalDateTime(fields.run_at).getTime();
      }
    }
  }

  db.prepare(
    `UPDATE reminders SET title=@title, message=@message, action=@action, enabled=@enabled,
       repeat=@repeat, cron_expr=@cron_expr, next_run=@next_run, email_to=@email_to WHERE id=@id`
  ).run({ ...next, repeat, cron_expr, next_run, id });

  return getAllReminders().find((r) => r.id === id);
}

export function getDueReminders() {
  const db = getDb();
  return db.prepare(`SELECT * FROM reminders WHERE enabled = 1 AND next_run <= ?`).all(Date.now());
}

/**
 * Persists which conversation a reminder's fired messages land in. Called
 * by the scheduler to "adopt" a freshly-created conversation the first
 * time a reminder fires with no (or a since-deleted) conversation_id, so
 * every later firing of that same reminder keeps landing in the same
 * place instead of silently failing or scattering across new ones.
 */
export function setReminderConversationId(id, conversationId) {
  const db = getDb();
  db.prepare(`UPDATE reminders SET conversation_id = ? WHERE id = ?`).run(conversationId, id);
}

/** Advances a recurring reminder to its next occurrence, or disables one-time reminders. */
export function advanceReminder(reminder) {
  const db = getDb();
  if (reminder.repeat === "once") {
    db.prepare(`UPDATE reminders SET enabled = 0 WHERE id = ?`).run(reminder.id);
    return;
  }
  let next;
  if (reminder.repeat === "cron") {
    next = nextCronRun(reminder.cron_expr, new Date(reminder.next_run + 1000));
  } else {
    next = new Date(reminder.next_run);
    if (reminder.repeat === "daily") next = addDays(next, 1);
    else if (reminder.repeat === "weekly") next = addDays(next, 7);
    else if (reminder.repeat === "weekdays") next = nextWeekday(next);
  }
  db.prepare(`UPDATE reminders SET next_run = ? WHERE id = ?`).run(next.getTime(), reminder.id);
}
