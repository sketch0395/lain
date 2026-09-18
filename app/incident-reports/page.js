"use client";

// Incident Report library — companion to the Playbooks page
// (app/playbooks/page.js): where Playbooks are the reference library of
// what to do during a security incident, this is the saved record of
// what actually happened. Lain compiles these automatically at the end of
// a tracked incident (see finish_incident_report in
// tools-agent/shared/tools/incidentReports.js) when the playbook that was
// followed is flagged "requires a report" — they can also be written
// here directly. Talks to /api/incident-reports.

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";

const EMPTY_FORM = { title: "", category: "", playbook_title: "", content: "", tags: "" };

export default function IncidentReportsPage() {
  const [entries, setEntries] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [filter, setFilter] = useState("");
  const [selectedId, setSelectedId] = useState(null);
  const [showAddForm, setShowAddForm] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [editing, setEditing] = useState(false);
  const [editForm, setEditForm] = useState(EMPTY_FORM);
  const [importing, setImporting] = useState(false);
  const [importMsg, setImportMsg] = useState("");
  const fileInputRef = useRef(null);

  useEffect(() => {
    load();
  }, []);

  function downloadUrl(params) {
    const qs = new URLSearchParams(params).toString();
    return `/api/incident-reports/export${qs ? `?${qs}` : ""}`;
  }

  async function load() {
    setLoading(true);
    try {
      const res = await fetch("/api/incident-reports");
      const data = await res.json();
      setEntries(data.entries || []);
    } catch {
      setError("Couldn't load incident reports.");
    }
    setLoading(false);
  }

  async function handleImportFile(e) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setImporting(true);
    setImportMsg("");
    setError("");
    try {
      const body = new FormData();
      body.append("file", file);
      const res = await fetch("/api/incident-reports/import", { method: "POST", body });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Import failed");
      setImportMsg(
        `Imported ${data.imported.length} report${data.imported.length === 1 ? "" : "s"}` +
          (data.errors?.length ? ` (${data.errors.length} skipped)` : "")
      );
      await load();
    } catch (err) {
      setError(err.message || "Couldn't import that file.");
    }
    setImporting(false);
  }

  async function addEntry(e) {
    e.preventDefault();
    if (!form.title.trim() || !form.content.trim()) return;
    setSaving(true);
    setError("");
    try {
      const res = await fetch("/api/incident-reports", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: form.title.trim(),
          category: form.category.trim(),
          playbookTitle: form.playbook_title.trim(),
          content: form.content.trim(),
          tags: form.tags.trim(),
        }),
      });
      if (!res.ok) throw new Error("Save failed");
      const { entry } = await res.json();
      setForm(EMPTY_FORM);
      setShowAddForm(false);
      await load();
      if (entry) setSelectedId(entry.id);
    } catch {
      setError("Couldn't save that report.");
    }
    setSaving(false);
  }

  function startEdit(entry) {
    setEditForm({
      title: entry.title,
      category: entry.category || "",
      playbook_title: entry.playbook_title || "",
      content: entry.content,
      tags: entry.tags || "",
    });
    setEditing(true);
  }

  async function saveEdit(entry) {
    if (!editForm.title.trim() || !editForm.content.trim()) return;
    setSaving(true);
    setError("");
    try {
      const res = await fetch(`/api/incident-reports/${entry.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: editForm.title.trim(),
          category: editForm.category.trim(),
          playbookTitle: editForm.playbook_title.trim(),
          content: editForm.content.trim(),
          tags: editForm.tags.trim(),
        }),
      });
      if (!res.ok) throw new Error("Save failed");
      setEditing(false);
      await load();
    } catch {
      setError("Couldn't save those changes.");
    }
    setSaving(false);
  }

  async function remove(id) {
    setEntries((prev) => prev.filter((e) => e.id !== id));
    if (selectedId === id) {
      setSelectedId(null);
      setEditing(false);
    }
    try {
      await fetch(`/api/incident-reports/${id}`, { method: "DELETE" });
    } catch {
      setError("Couldn't delete that — refreshing.");
      load();
    }
  }

  const filtered = useMemo(() => {
    const needle = filter.trim().toLowerCase();
    const list = needle
      ? entries.filter(
          (e) =>
            e.title.toLowerCase().includes(needle) ||
            (e.category || "").toLowerCase().includes(needle) ||
            (e.playbook_title || "").toLowerCase().includes(needle) ||
            (e.tags || "").toLowerCase().includes(needle)
        )
      : entries;
    return [...list].sort((a, b) => (b.created_at || 0) - (a.created_at || 0));
  }, [entries, filter]);

  const selectedEntry = filtered.find((e) => e.id === selectedId) || null;

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
            📝 Incident Reports
          </h1>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <input
            ref={fileInputRef}
            type="file"
            accept=".md,.zip,text/markdown,application/zip"
            onChange={handleImportFile}
            className="hidden"
          />
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={importing}
            title="Import a .md file or a .zip of .md files"
            className="rounded-lg bg-[var(--lain-panel-alt)] hover:bg-[var(--lain-panel)] px-3 py-1.5 text-sm font-semibold border border-[var(--lain-border)] disabled:opacity-50"
          >
            {importing ? "Importing…" : "⬆ Import"}
          </button>
          {entries.length > 0 && (
            <a
              href={downloadUrl({})}
              title="Download every report as a .zip of .md files"
              className="rounded-lg bg-[var(--lain-panel-alt)] hover:bg-[var(--lain-panel)] px-3 py-1.5 text-sm font-semibold border border-[var(--lain-border)]"
            >
              ⬇ Export All
            </a>
          )}
          <button
            type="button"
            onClick={() => setShowAddForm((v) => !v)}
            className="rounded-lg bg-[var(--lain-accent)] hover:bg-[var(--lain-accent-light)] px-3 py-1.5 text-sm font-semibold border border-[var(--lain-highlight)]/40"
          >
            {showAddForm ? "Cancel" : "+ New Report"}
          </button>
        </div>
      </header>

      <p className="px-4 pt-3 text-xs text-[var(--lain-muted)]">
        Finished write-ups of real incidents — what happened, what was
        found, what was done about it, and lessons learned. Lain compiles
        these automatically when she finishes following a playbook flagged
        to require one; you can also write one directly here.
      </p>

      {showAddForm && (
        <form
          onSubmit={addEntry}
          className="mx-4 mt-3 space-y-2 border border-[var(--lain-border)] rounded-lg p-3 bg-[var(--lain-panel)]"
        >
          <div className="grid grid-cols-2 gap-2">
            <input
              value={form.title}
              onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
              placeholder="Title (e.g. Ransomware — Finance Workstation)"
              className="bg-[var(--lain-panel-alt)] border border-[var(--lain-border)] rounded-lg px-3 py-2 text-sm text-[var(--lain-text)] placeholder:text-[var(--lain-muted)] focus:outline-none focus:ring-2 focus:ring-[var(--lain-highlight)]"
            />
            <input
              value={form.category}
              onChange={(e) => setForm((f) => ({ ...f, category: e.target.value }))}
              placeholder="Category (e.g. ransomware)"
              className="bg-[var(--lain-panel-alt)] border border-[var(--lain-border)] rounded-lg px-3 py-2 text-sm text-[var(--lain-text)] placeholder:text-[var(--lain-muted)] focus:outline-none focus:ring-2 focus:ring-[var(--lain-highlight)]"
            />
          </div>
          <input
            value={form.playbook_title}
            onChange={(e) => setForm((f) => ({ ...f, playbook_title: e.target.value }))}
            placeholder="Playbook followed (optional)"
            className="w-full bg-[var(--lain-panel-alt)] border border-[var(--lain-border)] rounded-lg px-3 py-2 text-sm text-[var(--lain-text)] placeholder:text-[var(--lain-muted)] focus:outline-none focus:ring-2 focus:ring-[var(--lain-highlight)]"
          />
          <textarea
            value={form.content}
            onChange={(e) => setForm((f) => ({ ...f, content: e.target.value }))}
            placeholder={"Report body (Markdown) — summary, timeline, steps taken, findings, actions, lessons learned…"}
            rows={10}
            className="w-full bg-[var(--lain-panel-alt)] border border-[var(--lain-border)] rounded-lg px-3 py-2 text-sm text-[var(--lain-text)] placeholder:text-[var(--lain-muted)] focus:outline-none focus:ring-2 focus:ring-[var(--lain-highlight)]"
          />
          <div className="flex gap-2">
            <input
              value={form.tags}
              onChange={(e) => setForm((f) => ({ ...f, tags: e.target.value }))}
              placeholder="Tags, comma separated (optional)"
              className="flex-1 bg-[var(--lain-panel-alt)] border border-[var(--lain-border)] rounded-lg px-3 py-2 text-sm text-[var(--lain-text)] placeholder:text-[var(--lain-muted)] focus:outline-none focus:ring-2 focus:ring-[var(--lain-highlight)]"
            />
            <button
              type="submit"
              disabled={saving || !form.title.trim() || !form.content.trim()}
              className="rounded-lg bg-[var(--lain-accent)] hover:bg-[var(--lain-accent-light)] px-3 py-2 text-sm font-semibold border border-[var(--lain-highlight)]/40 disabled:opacity-50"
            >
              Save
            </button>
          </div>
        </form>
      )}

      {error && <p className="px-4 pt-2 text-xs text-[var(--lain-accent-light)]">{error}</p>}
      {importMsg && <p className="px-4 pt-2 text-xs text-[var(--lain-muted)]">{importMsg}</p>}

      <div className="px-4 pt-3 pb-2 shrink-0">
        <input
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="Filter by title/category/playbook/tag…"
          className="w-full max-w-md bg-[var(--lain-panel-alt)] border border-[var(--lain-border)] rounded-lg px-3 py-2 text-sm text-[var(--lain-text)] placeholder:text-[var(--lain-muted)] focus:outline-none focus:ring-2 focus:ring-[var(--lain-highlight)]"
        />
      </div>

      {loading ? (
        <p className="px-4 text-sm text-[var(--lain-muted)]">Loading…</p>
      ) : filtered.length === 0 ? (
        <p className="px-4 text-sm text-[var(--lain-muted)]">
          No incident reports yet — they&apos;ll show up here once one is
          written, either by finishing a tracked incident in chat or
          adding one directly above.
        </p>
      ) : (
        <div className="flex-1 min-h-0 flex flex-col md:flex-row border-t border-[var(--lain-border)]">
          {/* Column 1: report list */}
          <div className="md:w-72 shrink-0 border-b md:border-b-0 md:border-r border-[var(--lain-border)] overflow-y-auto max-h-52 md:max-h-none">
            {filtered.map((e) => {
              const active = e.id === selectedId;
              return (
                <div
                  key={e.id}
                  className={`w-full flex items-center gap-1 pr-1 border-l-2 ${
                    active
                      ? "border-[var(--lain-accent)] bg-[var(--lain-panel-alt)]"
                      : "border-transparent hover:bg-[var(--lain-panel)]"
                  }`}
                >
                  <button
                    type="button"
                    onClick={() => {
                      setSelectedId(e.id);
                      setEditing(false);
                    }}
                    className={`flex-1 min-w-0 text-left px-3 py-2 text-sm ${
                      active ? "text-[var(--lain-text)]" : "text-[var(--lain-muted)] hover:text-[var(--lain-text)]"
                    }`}
                  >
                    <span className="block truncate">📄 {e.title}</span>
                    <span className="block text-[10px] opacity-60 truncate">
                      {e.category || "uncategorized"}
                      {e.created_at ? ` · ${new Date(e.created_at).toLocaleDateString()}` : ""}
                    </span>
                  </button>
                  <a
                    href={downloadUrl({ id: e.id })}
                    title="Export this report as a .md file"
                    className="shrink-0 text-xs text-[var(--lain-muted)] hover:text-[var(--lain-accent-light)] px-1"
                  >
                    ⬇
                  </a>
                </div>
              );
            })}
          </div>

          {/* Column 2: content preview / edit */}
          <div className="flex-1 min-h-0 overflow-y-auto p-4">
            {!selectedEntry ? (
              <p className="text-sm text-[var(--lain-muted)]">
                ← Select a report to view it.
              </p>
            ) : editing ? (
              <div className="space-y-2 max-w-3xl">
                <div className="grid grid-cols-2 gap-2">
                  <input
                    value={editForm.title}
                    onChange={(e) => setEditForm((f) => ({ ...f, title: e.target.value }))}
                    className="bg-[var(--lain-panel-alt)] border border-[var(--lain-border)] rounded-lg px-3 py-2 text-sm text-[var(--lain-text)] focus:outline-none focus:ring-2 focus:ring-[var(--lain-highlight)]"
                  />
                  <input
                    value={editForm.category}
                    onChange={(e) => setEditForm((f) => ({ ...f, category: e.target.value }))}
                    className="bg-[var(--lain-panel-alt)] border border-[var(--lain-border)] rounded-lg px-3 py-2 text-sm text-[var(--lain-text)] focus:outline-none focus:ring-2 focus:ring-[var(--lain-highlight)]"
                  />
                </div>
                <input
                  value={editForm.playbook_title}
                  onChange={(e) => setEditForm((f) => ({ ...f, playbook_title: e.target.value }))}
                  placeholder="Playbook followed"
                  className="w-full bg-[var(--lain-panel-alt)] border border-[var(--lain-border)] rounded-lg px-3 py-2 text-sm text-[var(--lain-text)] placeholder:text-[var(--lain-muted)] focus:outline-none focus:ring-2 focus:ring-[var(--lain-highlight)]"
                />
                <textarea
                  value={editForm.content}
                  onChange={(e) => setEditForm((f) => ({ ...f, content: e.target.value }))}
                  rows={16}
                  className="w-full bg-[var(--lain-panel-alt)] border border-[var(--lain-border)] rounded-lg px-3 py-2 text-sm text-[var(--lain-text)] focus:outline-none focus:ring-2 focus:ring-[var(--lain-highlight)]"
                />
                <input
                  value={editForm.tags}
                  onChange={(e) => setEditForm((f) => ({ ...f, tags: e.target.value }))}
                  placeholder="Tags, comma separated"
                  className="w-full bg-[var(--lain-panel-alt)] border border-[var(--lain-border)] rounded-lg px-3 py-2 text-sm text-[var(--lain-text)] placeholder:text-[var(--lain-muted)] focus:outline-none focus:ring-2 focus:ring-[var(--lain-highlight)]"
                />
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => saveEdit(selectedEntry)}
                    disabled={saving}
                    className="rounded-lg bg-[var(--lain-accent)] hover:bg-[var(--lain-accent-light)] px-3 py-1.5 text-sm font-semibold border border-[var(--lain-highlight)]/40 disabled:opacity-50"
                  >
                    Save changes
                  </button>
                  <button
                    type="button"
                    onClick={() => setEditing(false)}
                    className="text-xs text-[var(--lain-muted)] hover:text-[var(--lain-text)] border border-[var(--lain-border)] rounded-lg px-3 py-1.5"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            ) : (
              <div className="space-y-3 max-w-3xl">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-[10px] uppercase tracking-wide text-[var(--lain-muted)]">
                      {selectedEntry.category || "uncategorized"}
                      {selectedEntry.playbook_title ? ` · ${selectedEntry.playbook_title}` : ""}
                    </p>
                    <h2 className="text-base font-semibold text-[var(--lain-text)]">
                      {selectedEntry.title}
                    </h2>
                  </div>
                  <div className="flex gap-2 shrink-0">
                    <a
                      href={downloadUrl({ id: selectedEntry.id })}
                      title="Export this report as a .md file"
                      className="text-xs text-[var(--lain-muted)] hover:text-[var(--lain-accent-light)] border border-[var(--lain-border)] rounded-lg px-2 py-1"
                    >
                      Export
                    </a>
                    <button
                      type="button"
                      onClick={() => startEdit(selectedEntry)}
                      className="text-xs text-[var(--lain-muted)] hover:text-[var(--lain-accent-light)] border border-[var(--lain-border)] rounded-lg px-2 py-1"
                    >
                      Edit
                    </button>
                    <button
                      type="button"
                      onClick={() => remove(selectedEntry.id)}
                      className="text-xs text-[var(--lain-muted)] hover:text-[var(--lain-accent-light)] border border-[var(--lain-border)] rounded-lg px-2 py-1"
                    >
                      Delete
                    </button>
                  </div>
                </div>
                <p className="text-sm text-[var(--lain-text)] whitespace-pre-wrap leading-relaxed">
                  {selectedEntry.content}
                </p>
                {selectedEntry.tags && (
                  <div className="flex flex-wrap gap-1.5 pt-1">
                    {selectedEntry.tags.split(",").map((t) => t.trim()).filter(Boolean).map((t) => (
                      <span
                        key={t}
                        className="text-[10px] px-2 py-0.5 rounded-full bg-[var(--lain-panel-alt)] border border-[var(--lain-border)] text-[var(--lain-muted)]"
                      >
                        {t}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
