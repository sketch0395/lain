"use client";

// Reminders management panel: lets the user create/edit/cancel/delete
// reminders directly from the UI (including fully custom cron schedules),
// as an alternative to asking Lain in chat. Talks to /api/reminders.

import { useEffect, useState } from "react";

const REPEAT_OPTIONS = [
  { value: "once", label: "Once" },
  { value: "daily", label: "Daily" },
  { value: "weekly", label: "Weekly" },
  { value: "weekdays", label: "Weekdays" },
  { value: "cron", label: "Custom (cron)" },
];

const CRON_PRESETS = [
  { label: "Every 15 minutes", value: "*/15 * * * *" },
  { label: "Every hour", value: "0 * * * *" },
  { label: "Every day at 9am", value: "0 9 * * *" },
  { label: "Every weekday at 9am", value: "0 9 * * 1-5" },
  { label: "Every Mon/Wed/Fri at 6pm", value: "0 18 * * 1,3,5" },
  { label: "1st of every month at 9am", value: "0 9 1 * *" },
];

function emptyForm() {
  return {
    title: "",
    message: "",
    action: "notify",
    repeat: "once",
    run_at: "",
    cron_expr: "",
    email_to: "",
  };
}

/** Local datetime input value (YYYY-MM-DDTHH:MM) defaulting to ~1 hour from now. */
function defaultRunAt() {
  const d = new Date(Date.now() + 60 * 60 * 1000);
  d.setSeconds(0, 0);
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(
    d.getHours()
  )}:${pad(d.getMinutes())}`;
}

export default function RemindersPanel({ onClose }) {
  const [reminders, setReminders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [form, setForm] = useState(() => ({ ...emptyForm(), run_at: defaultRunAt() }));
  const [editingId, setEditingId] = useState(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    load();
  }, []);

  async function load() {
    setLoading(true);
    try {
      const res = await fetch("/api/reminders");
      const data = await res.json();
      setReminders(data.reminders || []);
    } catch {
      setError("Couldn't load reminders.");
    }
    setLoading(false);
  }

  function startEdit(r) {
    setEditingId(r.id);
    setForm({
      title: r.title,
      message: r.message,
      action: r.action,
      repeat: r.repeat,
      run_at: r.repeat === "cron" ? "" : toLocalInput(r.next_run),
      cron_expr: r.cron_expr || "",
      email_to: r.email_to || "",
    });
  }

  function toLocalInput(iso) {
    const d = new Date(iso);
    const pad = (n) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(
      d.getHours()
    )}:${pad(d.getMinutes())}`;
  }

  function resetForm() {
    setEditingId(null);
    setForm({ ...emptyForm(), run_at: defaultRunAt() });
  }

  async function submitForm(e) {
    e.preventDefault();
    setSaving(true);
    setError("");
    const payload = {
      title: form.title,
      message: form.message,
      action: form.action,
      repeat: form.repeat,
      ...(form.repeat === "cron"
        ? { cron_expr: form.cron_expr }
        : // Send the datetime-local value as-is (no browser-timezone
          // conversion) — the server interprets naive date-times in
          // LAIN_TIMEZONE, same as chat-created reminders.
          { run_at: form.run_at ? `${form.run_at}:00` : "" }),
      ...(form.email_to !== undefined ? { email_to: form.email_to } : {}),
    };

    try {
      const res = await fetch(
        editingId ? `/api/reminders/${editingId}` : "/api/reminders",
        {
          method: editingId ? "PATCH" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        }
      );
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to save reminder");
      resetForm();
      load();
    } catch (err) {
      setError(err.message);
    }
    setSaving(false);
  }

  async function toggleEnabled(r) {
    await fetch(`/api/reminders/${r.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ enabled: !r.enabled }),
    });
    load();
  }

  async function removeReminder(id) {
    await fetch(`/api/reminders/${id}`, { method: "DELETE" });
    if (editingId === id) resetForm();
    load();
  }

  function describeSchedule(r) {
    if (r.repeat === "cron") return `cron: ${r.cron_expr}`;
    const when = new Date(r.next_run).toLocaleString();
    const label = REPEAT_OPTIONS.find((o) => o.value === r.repeat)?.label || r.repeat;
    return `${label} — next: ${when}`;
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-lg max-h-[85vh] overflow-y-auto bg-[var(--lain-panel)] border border-[var(--lain-highlight)]/40 rounded-2xl p-5 space-y-4"
      >
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-bold bg-gradient-to-r from-[var(--lain-accent-light)] to-[var(--lain-highlight-soft)] bg-clip-text text-transparent">
            ⏰ Reminders
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close reminders"
            className="p-1 text-[var(--lain-muted)] hover:text-[var(--lain-text)]"
          >
            ✕
          </button>
        </div>

        <form
          onSubmit={submitForm}
          className="space-y-2 border border-[var(--lain-border)] rounded-xl p-3"
        >
          <p className="text-xs uppercase tracking-wide text-[var(--lain-muted)]">
            {editingId ? "Edit reminder" : "New reminder"}
          </p>
          <input
            required
            value={form.title}
            onChange={(e) => setForm({ ...form, title: e.target.value })}
            placeholder="Title (e.g. Timesheet)"
            className="w-full bg-[var(--lain-panel-alt)] border border-[var(--lain-border)] rounded-lg px-3 py-2 text-sm text-[var(--lain-text)] placeholder:text-[var(--lain-muted)] focus:outline-none focus:ring-2 focus:ring-[var(--lain-highlight)]"
          />
          <textarea
            required={form.action !== "digest"}
            value={form.message}
            onChange={(e) => setForm({ ...form, message: e.target.value })}
            placeholder={
              form.action === "digest"
                ? "Optional note/focus for the briefing (e.g. 'focus on work stuff')"
                : "Message to show when it fires"
            }
            rows={2}
            className="w-full bg-[var(--lain-panel-alt)] border border-[var(--lain-border)] rounded-lg px-3 py-2 text-sm text-[var(--lain-text)] placeholder:text-[var(--lain-muted)] focus:outline-none focus:ring-2 focus:ring-[var(--lain-highlight)]"
          />

          <div className="flex gap-2">
            <select
              value={form.action}
              onChange={(e) => setForm({ ...form, action: e.target.value })}
              className="flex-1 bg-[var(--lain-panel-alt)] border border-[var(--lain-border)] rounded-lg px-2 py-2 text-sm text-[var(--lain-text)]"
            >
              <option value="notify">Notify</option>
              <option value="news">Notify + news</option>
              <option value="digest">Proactive briefing</option>
            </select>
            <select
              value={form.repeat}
              onChange={(e) => setForm({ ...form, repeat: e.target.value })}
              className="flex-1 bg-[var(--lain-panel-alt)] border border-[var(--lain-border)] rounded-lg px-2 py-2 text-sm text-[var(--lain-text)]"
            >
              {REPEAT_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </div>

          {form.repeat === "cron" ? (
            <div className="space-y-1">
              <input
                required
                value={form.cron_expr}
                onChange={(e) => setForm({ ...form, cron_expr: e.target.value })}
                placeholder="Cron expression, e.g. 0 9 * * 1-5"
                className="w-full bg-[var(--lain-panel-alt)] border border-[var(--lain-border)] rounded-lg px-3 py-2 text-sm font-mono text-[var(--lain-text)] placeholder:text-[var(--lain-muted)] focus:outline-none focus:ring-2 focus:ring-[var(--lain-highlight)]"
              />
              <select
                onChange={(e) => e.target.value && setForm({ ...form, cron_expr: e.target.value })}
                defaultValue=""
                className="w-full bg-[var(--lain-panel-alt)] border border-[var(--lain-border)] rounded-lg px-2 py-1.5 text-xs text-[var(--lain-muted)]"
              >
                <option value="">Presets…</option>
                {CRON_PRESETS.map((p) => (
                  <option key={p.value} value={p.value}>
                    {p.label}
                  </option>
                ))}
              </select>
              <p className="text-[11px] text-[var(--lain-muted)]">
                Standard 5-field cron: minute hour day-of-month month day-of-week
              </p>
            </div>
          ) : (
            <input
              required
              type="datetime-local"
              value={form.run_at}
              onChange={(e) => setForm({ ...form, run_at: e.target.value })}
              className="w-full bg-[var(--lain-panel-alt)] border border-[var(--lain-border)] rounded-lg px-3 py-2 text-sm text-[var(--lain-text)] focus:outline-none focus:ring-2 focus:ring-[var(--lain-highlight)]"
            />
          )}

          <input
            type="text"
            value={form.email_to}
            onChange={(e) => setForm({ ...form, email_to: e.target.value })}
            placeholder="Email to (optional, comma-separated — uses server default if blank)"
            className="w-full bg-[var(--lain-panel-alt)] border border-[var(--lain-border)] rounded-lg px-3 py-2 text-sm text-[var(--lain-text)] placeholder:text-[var(--lain-muted)] focus:outline-none focus:ring-2 focus:ring-[var(--lain-highlight)]"
          />

          {error && <p className="text-xs text-[var(--lain-accent-light)]">{error}</p>}

          <div className="flex gap-2 pt-1">
            <button
              type="submit"
              disabled={saving}
              className="flex-1 rounded-lg bg-[var(--lain-accent)] hover:bg-[var(--lain-accent-light)] py-2 text-sm font-semibold border border-[var(--lain-highlight)]/40 disabled:opacity-50"
            >
              {editingId ? "Save changes" : "Create reminder"}
            </button>
            {editingId && (
              <button
                type="button"
                onClick={resetForm}
                className="rounded-lg border border-[var(--lain-border)] px-3 py-2 text-sm text-[var(--lain-muted)] hover:text-[var(--lain-text)]"
              >
                Cancel
              </button>
            )}
          </div>
        </form>

        <div className="space-y-2">
          <p className="text-xs uppercase tracking-wide text-[var(--lain-muted)]">
            All reminders
          </p>
          {loading ? (
            <p className="text-sm text-[var(--lain-muted)]">Loading…</p>
          ) : reminders.length === 0 ? (
            <p className="text-sm text-[var(--lain-muted)]">No reminders yet.</p>
          ) : (
            reminders.map((r) => (
              <div
                key={r.id}
                className={`rounded-lg border border-[var(--lain-border)] p-2.5 space-y-1 ${
                  r.enabled ? "" : "opacity-50"
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="font-semibold text-sm truncate">{r.title}</span>
                  <span className="flex items-center gap-2 shrink-0 text-xs">
                    <button
                      type="button"
                      onClick={() => toggleEnabled(r)}
                      title={r.enabled ? "Disable" : "Enable"}
                      className="text-[var(--lain-muted)] hover:text-[var(--lain-text)]"
                    >
                      {r.enabled ? "🔔" : "🔕"}
                    </button>
                    <button
                      type="button"
                      onClick={() => startEdit(r)}
                      title="Edit"
                      className="text-[var(--lain-muted)] hover:text-[var(--lain-highlight)]"
                    >
                      ✎
                    </button>
                    <button
                      type="button"
                      onClick={() => removeReminder(r.id)}
                      title="Delete"
                      className="text-[var(--lain-muted)] hover:text-[var(--lain-accent-light)]"
                    >
                      ✕
                    </button>
                  </span>
                </div>
                <p className="text-xs text-[var(--lain-muted)]">{r.message}</p>
                <p className="text-[11px] text-[var(--lain-highlight-soft)]">
                  {describeSchedule(r)}
                  {r.action === "news" ? " · + news" : ""}
                  {r.action === "digest" ? " · 🔮 briefing" : ""}
                  {r.email_to ? ` · 📧 ${r.email_to}` : ""}
                </p>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
