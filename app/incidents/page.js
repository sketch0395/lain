"use client";

// Incident cases — the durable case objects Lain (or you) open during a
// security incident: severity/status/phase, an append-only timeline, and
// the chats that worked on the case. Finished write-ups live separately in
// /incident-reports. Talks to /api/incidents.

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";

// Keep these in sync with SEVERITIES/STATUSES/PHASES in
// lib/incidentCases.js (not imported here so the server
// module stays out of the client bundle).
const SEVERITIES = ["low", "medium", "high", "critical"];
const STATUSES = ["open", "investigating", "contained", "resolved", "closed"];
const PHASES = ["triage", "containment", "eradication", "recovery", "review"];
const EVENT_TYPES = ["note", "finding", "action"];
// Keep in sync with VERDICTS in lib/incidentIocs.js.
// Keep in sync with STEP_STATUSES in lib/playbookRuns.js.
const STEP_ICON = { pending: "○", done: "✅", skipped: "⏭️", blocked: "⛔" };
const VERDICTS = ["unknown", "benign", "suspicious", "malicious"];
const VERDICT_STYLE = {
  unknown: "text-[var(--lain-muted)] border-[var(--lain-border)]",
  benign: "text-emerald-300 border-emerald-400/40",
  suspicious: "text-orange-300 border-orange-400/50",
  malicious: "text-red-400 border-red-500/60",
};

const SEVERITY_STYLE = {
  low: "text-sky-300 border-sky-400/40",
  medium: "text-yellow-300 border-yellow-400/40",
  high: "text-orange-300 border-orange-400/50",
  critical: "text-red-400 border-red-500/60",
};

const INPUT =
  "bg-[var(--lain-panel-alt)] border border-[var(--lain-border)] rounded-lg px-3 py-2 text-sm text-[var(--lain-text)] placeholder:text-[var(--lain-muted)] focus:outline-none focus:ring-2 focus:ring-[var(--lain-highlight)]";
const BTN =
  "text-xs text-[var(--lain-muted)] hover:text-[var(--lain-accent-light)] border border-[var(--lain-border)] rounded-lg px-2 py-1";

const EMPTY_FORM = { title: "", severity: "medium", category: "", summary: "" };

function fmt(ts) {
  return ts ? new Date(ts).toLocaleString() : "";
}

function SeverityBadge({ severity }) {
  return (
    <span
      className={`text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded border ${
        SEVERITY_STYLE[severity] || ""
      }`}
    >
      {severity}
    </span>
  );
}

export default function IncidentsPage() {
  const router = useRouter();
  const [incidents, setIncidents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [statusFilter, setStatusFilter] = useState("active");
  const [selectedId, setSelectedId] = useState(null);
  const [detail, setDetail] = useState(null);
  const [showAddForm, setShowAddForm] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [noteType, setNoteType] = useState("note");
  const [noteText, setNoteText] = useState("");
  const [summaryDraft, setSummaryDraft] = useState(null);
  const [iocText, setIocText] = useState("");
  const [iocBusy, setIocBusy] = useState(false);
  const [iocMsg, setIocMsg] = useState("");
  const [playbooks, setPlaybooks] = useState([]);
  const [pickedPlaybook, setPickedPlaybook] = useState("");

  useEffect(() => {
    loadList();
  }, []);

  function selectCase(id) {
    setSelectedId(id);
    if (id == null) {
      setDetail(null);
      return;
    }
    loadDetail(id);
    fetch("/api/playbooks")
      .then((r) => r.json())
      .then((d) => setPlaybooks(d.entries || []))
      .catch(() => {});
  }

  async function loadList() {
    setLoading(true);
    try {
      const res = await fetch("/api/incidents");
      const data = await res.json();
      setIncidents(data.incidents || []);
    } catch {
      setError("Couldn't load incidents.");
    }
    setLoading(false);
  }

  async function loadDetail(id) {
    try {
      const res = await fetch(`/api/incidents/${id}`);
      if (!res.ok) throw new Error();
      const data = await res.json();
      setDetail(data.incident);
      setSummaryDraft(null);
    } catch {
      setError("Couldn't load that incident.");
    }
  }

  async function createCase(e) {
    e.preventDefault();
    if (!form.title.trim()) return;
    setSaving(true);
    setError("");
    try {
      const res = await fetch("/api/incidents", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Save failed");
      setForm(EMPTY_FORM);
      setShowAddForm(false);
      await loadList();
      selectCase(data.incident.id);
    } catch (err) {
      setError(err.message || "Couldn't open that incident.");
    }
    setSaving(false);
  }

  async function patch(fields) {
    setError("");
    try {
      const res = await fetch(`/api/incidents/${selectedId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(fields),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Update failed");
      setDetail(data.incident);
      setSummaryDraft(null);
      await loadList();
    } catch (err) {
      setError(err.message || "Couldn't update that incident.");
    }
  }

  async function addNote(e) {
    e.preventDefault();
    if (!noteText.trim()) return;
    setError("");
    try {
      const res = await fetch(`/api/incidents/${selectedId}/events`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: noteType, content: noteText.trim() }),
      });
      if (!res.ok) throw new Error();
      setNoteText("");
      await loadDetail(selectedId);
      await loadList();
    } catch {
      setError("Couldn't add that entry.");
    }
  }

  async function startRun() {
    if (!pickedPlaybook) return;
    setError("");
    try {
      const res = await fetch(`/api/incidents/${selectedId}/runs`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ playbookId: Number(pickedPlaybook) }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Couldn't start the playbook");
      setPickedPlaybook("");
      await refreshCase();
    } catch (err) {
      setError(err.message || "Couldn't start the playbook.");
    }
  }

  async function patchRun(runId, body) {
    setError("");
    try {
      const res = await fetch(`/api/incidents/${selectedId}/runs/${runId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Update failed");
      await refreshCase();
    } catch (err) {
      setError(err.message || "Update failed.");
    }
  }

  function setStep(runId, step, status) {
    let note;
    if (status === "skipped" || status === "blocked") {
      note = window.prompt(`Why is this step ${status}?`);
      if (!note?.trim()) return;
    }
    return patchRun(runId, { step: step.position, status, note });
  }

  async function refreshCase() {
    await loadDetail(selectedId);
    await loadList();
  }

  async function addIocs(e) {
    e.preventDefault();
    if (!iocText.trim()) return;
    setIocBusy(true);
    setIocMsg("");
    setError("");
    try {
      const res = await fetch(`/api/incidents/${selectedId}/iocs`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: iocText }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Couldn't add indicators");
      setIocMsg(
        data.added.length
          ? `Added ${data.added.length} indicator${data.added.length === 1 ? "" : "s"}.`
          : "No new indicators found in that text."
      );
      setIocText("");
      await refreshCase();
    } catch (err) {
      setError(err.message || "Couldn't add indicators.");
    }
    setIocBusy(false);
  }

  async function enrich(iocId) {
    setIocBusy(true);
    setIocMsg("");
    setError("");
    try {
      const res = await fetch(`/api/incidents/${selectedId}/iocs/enrich`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(iocId ? { iocId } : {}),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Enrichment failed");
      const skipped = data.results.filter((r) => r.skipped && !r.errors).length;
      const failed = data.results.filter((r) => r.errors).length;
      setIocMsg(
        `Checked ${data.results.length - skipped} indicator(s)` +
          (skipped ? `, skipped ${skipped} (private IP or no source configured)` : "") +
          (failed ? `, ${failed} had lookup errors` : "") +
          (data.remaining ? `. ${data.remaining} more pending — click Enrich again.` : ".")
      );
      await refreshCase();
    } catch (err) {
      setError(err.message || "Enrichment failed.");
    }
    setIocBusy(false);
  }

  async function setIocVerdict(iocId, verdict) {
    setError("");
    try {
      const res = await fetch(`/api/incidents/${selectedId}/iocs/${iocId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ verdict }),
      });
      if (!res.ok) throw new Error();
      await refreshCase();
    } catch {
      setError("Couldn't update that indicator.");
    }
  }

  async function removeIoc(iocId) {
    setError("");
    try {
      await fetch(`/api/incidents/${selectedId}/iocs/${iocId}`, { method: "DELETE" });
      await refreshCase();
    } catch {
      setError("Couldn't remove that indicator.");
    }
  }

  async function openChat(existingConversationId) {
    if (existingConversationId) {
      router.push(`/?c=${existingConversationId}`);
      return;
    }
    setError("");
    try {
      const res = await fetch(`/api/incidents/${selectedId}/conversation`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error();
      router.push(`/?c=${data.conversationId}`);
    } catch {
      setError("Couldn't start a chat for this incident.");
    }
  }

  async function remove() {
    if (!window.confirm("Delete this incident and its timeline? This can't be undone.")) return;
    try {
      await fetch(`/api/incidents/${selectedId}`, { method: "DELETE" });
      selectCase(null);
      await loadList();
    } catch {
      setError("Couldn't delete that incident.");
    }
  }

  const visible = useMemo(() => {
    if (statusFilter === "all") return incidents;
    if (statusFilter === "active") {
      return incidents.filter((i) => i.status !== "resolved" && i.status !== "closed");
    }
    return incidents.filter((i) => i.status === statusFilter);
  }, [incidents, statusFilter]);

  const conversations = detail?.links.filter((l) => l.kind === "conversation") || [];

  return (
    <div className="h-dvh flex flex-col bg-[var(--lain-bg)] text-[var(--lain-text)]">
      <header className="flex items-center justify-between gap-3 border-b border-[var(--lain-border)] px-4 py-3 shrink-0">
        <div className="flex items-center gap-3 min-w-0">
          <Link
            href="/"
            aria-label="Back to chat"
            className="text-[var(--lain-muted)] hover:text-[var(--lain-text)] shrink-0"
          >
            ←
          </Link>
          <h1 className="text-lg font-bold bg-gradient-to-r from-[var(--lain-accent-light)] to-[var(--lain-highlight-soft)] bg-clip-text text-transparent truncate">
            🚨 Incidents
          </h1>
        </div>
        <button
          type="button"
          onClick={() => setShowAddForm((v) => !v)}
          className="rounded-lg bg-[var(--lain-accent)] hover:bg-[var(--lain-accent-light)] px-3 py-1.5 text-sm font-semibold border border-[var(--lain-highlight)]/40 shrink-0"
        >
          {showAddForm ? "Cancel" : "+ New Incident"}
        </button>
      </header>

      <p className="px-4 pt-3 text-xs text-[var(--lain-muted)]">
        Incident cases — each tracks severity, status, phase, a timeline of
        findings and actions, and the chats that worked on it. Lain opens and
        updates these during a response; you can also manage them here.
      </p>

      {error && <p className="px-4 pt-2 text-xs text-red-400">{error}</p>}

      {showAddForm && (
        <form
          onSubmit={createCase}
          className="mx-4 mt-3 space-y-2 border border-[var(--lain-border)] rounded-lg p-3 bg-[var(--lain-panel)]"
        >
          <div className="grid grid-cols-3 gap-2">
            <input
              value={form.title}
              onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
              placeholder="Title (e.g. Phishing — finance team)"
              className={`${INPUT} col-span-2`}
            />
            <select
              value={form.severity}
              onChange={(e) => setForm((f) => ({ ...f, severity: e.target.value }))}
              className={INPUT}
            >
              {SEVERITIES.map((s) => (
                <option key={s}>{s}</option>
              ))}
            </select>
          </div>
          <input
            value={form.category}
            onChange={(e) => setForm((f) => ({ ...f, category: e.target.value }))}
            placeholder="Category (e.g. phishing)"
            className={`w-full ${INPUT}`}
          />
          <textarea
            value={form.summary}
            onChange={(e) => setForm((f) => ({ ...f, summary: e.target.value }))}
            placeholder="What happened / how it was detected"
            rows={3}
            className={`w-full ${INPUT}`}
          />
          <button
            type="submit"
            disabled={saving || !form.title.trim()}
            className="rounded-lg bg-[var(--lain-accent)] hover:bg-[var(--lain-accent-light)] px-3 py-1.5 text-sm font-semibold border border-[var(--lain-highlight)]/40 disabled:opacity-50"
          >
            {saving ? "Opening…" : "Open incident"}
          </button>
        </form>
      )}

      <div className="px-4 py-3 flex gap-2 shrink-0">
        {["active", "all", ...STATUSES].map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => setStatusFilter(s)}
            className={`text-xs rounded-full px-2.5 py-1 border ${
              statusFilter === s
                ? "border-[var(--lain-highlight)] text-[var(--lain-text)]"
                : "border-[var(--lain-border)] text-[var(--lain-muted)]"
            }`}
          >
            {s}
          </button>
        ))}
      </div>

      {loading ? (
        <p className="px-4 text-sm text-[var(--lain-muted)]">Loading…</p>
      ) : visible.length === 0 ? (
        <p className="px-4 text-sm text-[var(--lain-muted)]">
          No incidents here yet — open one above, or ask Lain to when you
          report something in chat.
        </p>
      ) : (
        <div className="flex-1 min-h-0 flex border-t border-[var(--lain-border)]">
          {/* Column 1: case list */}
          <div className="w-80 shrink-0 overflow-y-auto border-r border-[var(--lain-border)]">
            {visible.map((i) => (
              <button
                key={i.id}
                type="button"
                onClick={() => selectCase(i.id)}
                className={`w-full text-left px-3 py-2 border-b border-[var(--lain-border)] ${
                  i.id === selectedId ? "bg-[var(--lain-panel)]" : "hover:bg-[var(--lain-panel-alt)]"
                }`}
              >
                <div className="flex items-center gap-2">
                  <SeverityBadge severity={i.severity} />
                  <span className="text-[10px] uppercase text-[var(--lain-muted)]">
                    {i.status} · {i.phase}
                  </span>
                </div>
                <p className="text-sm text-[var(--lain-text)] truncate">
                  #{i.id} {i.title}
                </p>
                <p className="text-[10px] text-[var(--lain-muted)]">
                  {i.event_count} events · {i.ioc_count} IOCs · updated {fmt(i.updated_at)}
                </p>
              </button>
            ))}
          </div>

          {/* Column 2: case detail */}
          <div className="flex-1 min-h-0 overflow-y-auto p-4">
            {!detail ? (
              <p className="text-sm text-[var(--lain-muted)]">← Select an incident to view it.</p>
            ) : (
              <div className="space-y-4 max-w-3xl">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-[10px] uppercase tracking-wide text-[var(--lain-muted)]">
                      #{detail.id}
                      {detail.category ? ` · ${detail.category}` : ""} · opened {fmt(detail.created_at)}
                    </p>
                    <h2 className="text-base font-semibold text-[var(--lain-text)]">
                      {detail.title}
                    </h2>
                  </div>
                  <div className="flex gap-2 shrink-0">
                    <button type="button" onClick={() => openChat(conversations[0]?.ref)} className={BTN}>
                      {conversations.length ? "💬 Open chat" : "💬 Start chat"}
                    </button>
                    <button type="button" onClick={remove} className={BTN}>
                      Delete
                    </button>
                  </div>
                </div>

                <div className="grid grid-cols-3 gap-2">
                  {[
                    ["severity", SEVERITIES],
                    ["status", STATUSES],
                    ["phase", PHASES],
                  ].map(([field, options]) => (
                    <label key={field} className="text-[10px] uppercase text-[var(--lain-muted)]">
                      {field}
                      <select
                        value={detail[field]}
                        onChange={(e) => patch({ [field]: e.target.value })}
                        className={`${INPUT} w-full mt-1 normal-case`}
                      >
                        {options.map((o) => (
                          <option key={o}>{o}</option>
                        ))}
                      </select>
                    </label>
                  ))}
                </div>

                <div>
                  <p className="text-[10px] uppercase text-[var(--lain-muted)] mb-1">Summary</p>
                  <textarea
                    value={summaryDraft ?? detail.summary}
                    onChange={(e) => setSummaryDraft(e.target.value)}
                    rows={3}
                    className={`w-full ${INPUT}`}
                  />
                  {summaryDraft !== null && summaryDraft !== detail.summary && (
                    <button
                      type="button"
                      onClick={() => patch({ summary: summaryDraft })}
                      className={`${BTN} mt-1`}
                    >
                      Save summary
                    </button>
                  )}
                </div>

                {conversations.length > 1 && (
                  <div className="flex flex-wrap gap-2">
                    {conversations.map((c, idx) => (
                      <button key={c.ref} type="button" onClick={() => openChat(c.ref)} className={BTN}>
                        Chat {idx + 1}
                      </button>
                    ))}
                  </div>
                )}

                <div>
                  <p className="text-[10px] uppercase text-[var(--lain-muted)] mb-2">
                    Playbook runs ({detail.runs.length})
                  </p>
                  {detail.runs.map((run) => {
                    const finished = run.steps.filter((x) => x.status === "done" || x.status === "skipped").length;
                    return (
                      <div key={run.id} className="border border-[var(--lain-border)] rounded-lg px-2.5 py-2 mb-2">
                        <div className="flex items-center gap-2 text-sm">
                          <span className="flex-1 text-[var(--lain-text)]">{run.playbook_title}</span>
                          <span className="text-[10px] uppercase text-[var(--lain-muted)]">
                            {run.status} · {finished}/{run.steps.length}
                          </span>
                          {run.status === "active" && (
                            <button
                              type="button"
                              onClick={() => patchRun(run.id, { finish: "abandoned" })}
                              className="text-xs text-[var(--lain-muted)] hover:text-[var(--lain-accent-light)]"
                            >
                              Abandon
                            </button>
                          )}
                        </div>
                        <ol className="mt-1.5 space-y-1">
                          {run.steps.map((step) => (
                            <li key={step.id} className="flex items-start gap-2 text-xs">
                              <span className="w-5 shrink-0">{STEP_ICON[step.status]}</span>
                              <span className="flex-1 text-[var(--lain-text)]">
                                {step.section && (
                                  <span className="text-[var(--lain-muted)]">{step.section}: </span>
                                )}
                                {step.text}
                                {step.note && (
                                  <span className="block text-[var(--lain-muted)]">↳ {step.note}</span>
                                )}
                              </span>
                              {run.status === "active" && (
                                <span className="flex gap-1 shrink-0">
                                  {step.status !== "done" && (
                                    <button type="button" title="Mark done" onClick={() => setStep(run.id, step, "done")}>
                                      ✔
                                    </button>
                                  )}
                                  {step.status !== "skipped" && (
                                    <button type="button" title="Skip" onClick={() => setStep(run.id, step, "skipped")}>
                                      ⏭
                                    </button>
                                  )}
                                  {step.status !== "blocked" && (
                                    <button type="button" title="Blocked" onClick={() => setStep(run.id, step, "blocked")}>
                                      ⛔
                                    </button>
                                  )}
                                  {step.status !== "pending" && (
                                    <button type="button" title="Reopen" onClick={() => setStep(run.id, step, "pending")}>
                                      ↺
                                    </button>
                                  )}
                                </span>
                              )}
                            </li>
                          ))}
                        </ol>
                      </div>
                    );
                  })}
                  <div className="flex gap-2">
                    <select
                      value={pickedPlaybook}
                      onChange={(e) => setPickedPlaybook(e.target.value)}
                      className={`flex-1 ${INPUT}`}
                    >
                      <option value="">Run a playbook…</option>
                      {playbooks.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.category}: {p.title}
                        </option>
                      ))}
                    </select>
                    <button
                      type="button"
                      onClick={startRun}
                      disabled={!pickedPlaybook}
                      className={`${BTN} disabled:opacity-50`}
                    >
                      Start
                    </button>
                  </div>
                </div>

                <div>
                  <div className="flex items-center justify-between mb-2">
                    <p className="text-[10px] uppercase text-[var(--lain-muted)]">
                      Indicators ({detail.iocs.length})
                    </p>
                    {detail.iocs.length > 0 && (
                      <button
                        type="button"
                        onClick={() => enrich()}
                        disabled={iocBusy}
                        title="Check pending indicators against AbuseIPDB / URLhaus / VirusTotal"
                        className={`${BTN} disabled:opacity-50`}
                      >
                        {iocBusy ? "Working…" : "🔍 Enrich"}
                      </button>
                    )}
                  </div>
                  {iocMsg && <p className="text-xs text-[var(--lain-muted)] mb-2">{iocMsg}</p>}
                  {detail.iocs.length > 0 && (
                    <div className="space-y-1.5 mb-2">
                      {detail.iocs.map((ioc) => (
                        <div
                          key={ioc.id}
                          className="border border-[var(--lain-border)] rounded-lg px-2.5 py-2 text-sm"
                        >
                          <div className="flex items-center gap-2">
                            <span className="text-[10px] uppercase text-[var(--lain-muted)] w-12 shrink-0">
                              {ioc.type}
                            </span>
                            <span className="font-mono text-xs text-[var(--lain-text)] truncate flex-1" title={ioc.value}>
                              {ioc.value}
                            </span>
                            <select
                              value={ioc.verdict}
                              onChange={(e) => setIocVerdict(ioc.id, e.target.value)}
                              title={ioc.locked ? "Set by an analyst — auto-enrichment won't change it" : "Verdict"}
                              className={`text-[10px] uppercase bg-transparent border rounded px-1 py-0.5 ${VERDICT_STYLE[ioc.verdict]}`}
                            >
                              {VERDICTS.map((v) => (
                                <option key={v} value={v} className="text-black normal-case">
                                  {v}
                                </option>
                              ))}
                            </select>
                            {ioc.locked && <span title="Analyst-set">🔒</span>}
                            <button
                              type="button"
                              onClick={() => enrich(ioc.id)}
                              disabled={iocBusy}
                              title="Re-check this indicator"
                              className="text-xs text-[var(--lain-muted)] hover:text-[var(--lain-accent-light)] disabled:opacity-50"
                            >
                              🔍
                            </button>
                            <button
                              type="button"
                              onClick={() => removeIoc(ioc.id)}
                              title="Remove indicator"
                              className="text-xs text-[var(--lain-muted)] hover:text-[var(--lain-accent-light)]"
                            >
                              ✕
                            </button>
                          </div>
                          {ioc.summary && (
                            <p className="text-[11px] text-[var(--lain-muted)] mt-1 pl-14">
                              {ioc.summary}
                              {ioc.confidence != null ? ` · confidence ${ioc.confidence}` : ""}
                            </p>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                  <form onSubmit={addIocs} className="flex gap-2">
                    <input
                      value={iocText}
                      onChange={(e) => setIocText(e.target.value)}
                      placeholder="Paste text or an indicator (IP, domain, URL, hash, email — defanged OK)"
                      className={`flex-1 ${INPUT}`}
                    />
                    <button
                      type="submit"
                      disabled={iocBusy || !iocText.trim()}
                      className={`${BTN} disabled:opacity-50`}
                    >
                      Extract
                    </button>
                  </form>
                </div>

                <div>
                  <p className="text-[10px] uppercase text-[var(--lain-muted)] mb-2">Timeline</p>
                  <ol className="space-y-2 border-l border-[var(--lain-border)] pl-3">
                    {detail.events.map((ev) => (
                      <li key={ev.id} className="text-sm">
                        <p className="text-[10px] text-[var(--lain-muted)]">
                          {fmt(ev.created_at)} · {ev.type.replace("_", " ")}
                          {ev.author ? ` · ${ev.author}` : ""}
                        </p>
                        <p className="text-[var(--lain-text)] whitespace-pre-wrap">{ev.content}</p>
                      </li>
                    ))}
                  </ol>
                  <form onSubmit={addNote} className="flex gap-2 mt-3">
                    <select
                      value={noteType}
                      onChange={(e) => setNoteType(e.target.value)}
                      className={INPUT}
                    >
                      {EVENT_TYPES.map((t) => (
                        <option key={t}>{t}</option>
                      ))}
                    </select>
                    <input
                      value={noteText}
                      onChange={(e) => setNoteText(e.target.value)}
                      placeholder="Add a note, finding, or action…"
                      className={`flex-1 ${INPUT}`}
                    />
                    <button type="submit" disabled={!noteText.trim()} className={`${BTN} disabled:opacity-50`}>
                      Add
                    </button>
                  </form>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
