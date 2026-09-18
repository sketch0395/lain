"use client";

// Incident Response Playbook library — modeled directly on the Threat
// Intel page (app/threat-intel/page.js): a dedicated page presented like
// a file directory (categories are folders, titles are files, content is
// a preview pane). Playbooks are step-by-step runbooks Lain follows when
// the user calls out an active/suspected security incident (see
// lookup_playbook/add_playbook in lib/tools/cyberIntel.js). This page is
// the human-curated, browsable side — write or transcribe a playbook here
// and Lain will use it. Talks to /api/playbooks.

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";

const EMPTY_FORM = { category: "", title: "", content: "", tags: "" };

export default function PlaybooksPage() {
  const [entries, setEntries] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [filter, setFilter] = useState("");
  const [selectedCategory, setSelectedCategory] = useState(null);
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
    return `/api/playbooks/export${qs ? `?${qs}` : ""}`;
  }

  async function handleImportFile(e) {
    const file = e.target.files?.[0];
    e.target.value = ""; // allow re-selecting the same file later
    if (!file) return;
    setImporting(true);
    setImportMsg("");
    setError("");
    try {
      const body = new FormData();
      body.append("file", file);
      const res = await fetch("/api/playbooks/import", { method: "POST", body });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Import failed");
      setImportMsg(
        `Imported ${data.imported.length} playbook${data.imported.length === 1 ? "" : "s"}` +
          (data.errors?.length ? ` (${data.errors.length} skipped)` : "")
      );
      await load();
    } catch (err) {
      setError(err.message || "Couldn't import that file.");
    }
    setImporting(false);
  }

  async function load() {
    setLoading(true);
    try {
      const res = await fetch("/api/playbooks");
      const data = await res.json();
      setEntries(data.entries || []);
    } catch {
      setError("Couldn't load the playbook library.");
    }
    setLoading(false);
  }

  async function addEntry(e) {
    e.preventDefault();
    if (!form.category.trim() || !form.title.trim() || !form.content.trim()) return;
    setSaving(true);
    setError("");
    try {
      const res = await fetch("/api/playbooks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          category: form.category.trim(),
          title: form.title.trim(),
          content: form.content.trim(),
          tags: form.tags.trim(),
        }),
      });
      if (!res.ok) throw new Error("Save failed");
      const { entry } = await res.json();
      setForm(EMPTY_FORM);
      setShowAddForm(false);
      await load();
      if (entry) {
        setSelectedCategory(entry.category);
        setSelectedId(entry.id);
      }
    } catch {
      setError("Couldn't save that playbook.");
    }
    setSaving(false);
  }

  function startEdit(entry) {
    setEditForm({
      category: entry.category,
      title: entry.title,
      content: entry.content,
      tags: entry.tags || "",
    });
    setEditing(true);
  }

  async function saveEdit(entry) {
    if (!editForm.category.trim() || !editForm.title.trim() || !editForm.content.trim()) return;
    setSaving(true);
    setError("");
    try {
      const res = await fetch(`/api/playbooks/${entry.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          category: editForm.category.trim(),
          title: editForm.title.trim(),
          content: editForm.content.trim(),
          tags: editForm.tags.trim(),
        }),
      });
      if (!res.ok) throw new Error("Save failed");
      const { entry: updated } = await res.json();
      setEditing(false);
      await load();
      if (updated) {
        setSelectedCategory(updated.category);
        setSelectedId(updated.id);
      }
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
      await fetch(`/api/playbooks/${id}`, { method: "DELETE" });
    } catch {
      setError("Couldn't delete that — refreshing.");
      load();
    }
  }

  // Filtered set (search matches title/category/tags), then grouped into a
  // folder-tree shape: { category -> [entries] }.
  const { tree, categoryOrder } = useMemo(() => {
    const needle = filter.trim().toLowerCase();
    const filtered = needle
      ? entries.filter(
          (e) =>
            e.title.toLowerCase().includes(needle) ||
            e.category.toLowerCase().includes(needle) ||
            (e.tags || "").toLowerCase().includes(needle)
        )
      : entries;
    const byCategory = new Map();
    for (const e of filtered) {
      if (!byCategory.has(e.category)) byCategory.set(e.category, []);
      byCategory.get(e.category).push(e);
    }
    for (const list of byCategory.values()) {
      list.sort((a, b) => a.title.localeCompare(b.title));
    }
    const order = [...byCategory.keys()].sort((a, b) => a.localeCompare(b));
    return { tree: byCategory, categoryOrder: order };
  }, [entries, filter]);

  // Category may have been deleted/filtered out from under the current
  // selection — derive the effective category instead of syncing it back
  // with a setState-in-effect (an unnecessary render-cascade pattern).
  const effectiveCategory =
    selectedCategory && tree.has(selectedCategory) ? selectedCategory : null;

  const titlesInCategory = effectiveCategory ? tree.get(effectiveCategory) || [] : [];
  const selectedEntry = titlesInCategory.find((e) => e.id === selectedId) || null;

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
            📘 Incident Response Playbooks
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
              title="Download every playbook as a .zip of .md files"
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
            {showAddForm ? "Cancel" : "+ New Playbook"}
          </button>
        </div>
      </header>

      <p className="px-4 pt-3 text-xs text-[var(--lain-muted)]">
        Step-by-step runbooks for handling specific security incidents —
        phishing reports, ransomware, account compromise, data exfiltration,
        malware infections, and anything else worth having on hand. When you
        describe an active incident in chat, Lain looks here first and
        follows the matching playbook. Browse it like a file tree: pick a
        category folder, then a title.
      </p>

      {showAddForm && (
        <form
          onSubmit={addEntry}
          className="mx-4 mt-3 space-y-2 border border-[var(--lain-border)] rounded-lg p-3 bg-[var(--lain-panel)]"
        >
          <div className="grid grid-cols-2 gap-2">
            <input
              value={form.category}
              onChange={(e) => setForm((f) => ({ ...f, category: e.target.value }))}
              placeholder="Category (e.g. ransomware)"
              list="playbook-categories"
              className="bg-[var(--lain-panel-alt)] border border-[var(--lain-border)] rounded-lg px-3 py-2 text-sm text-[var(--lain-text)] placeholder:text-[var(--lain-muted)] focus:outline-none focus:ring-2 focus:ring-[var(--lain-highlight)]"
            />
            <datalist id="playbook-categories">
              {categoryOrder.map((c) => (
                <option key={c} value={c} />
              ))}
            </datalist>
            <input
              value={form.title}
              onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
              placeholder="Title (e.g. Suspected Phishing Email)"
              className="bg-[var(--lain-panel-alt)] border border-[var(--lain-border)] rounded-lg px-3 py-2 text-sm text-[var(--lain-text)] placeholder:text-[var(--lain-muted)] focus:outline-none focus:ring-2 focus:ring-[var(--lain-highlight)]"
            />
          </div>
          <textarea
            value={form.content}
            onChange={(e) => setForm((f) => ({ ...f, content: e.target.value }))}
            placeholder={"Steps, numbered in order:\n1. Detect...\n2. Contain...\n3. Eradicate...\n4. Recover...\n5. Lessons learned..."}
            rows={8}
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
              disabled={
                saving || !form.category.trim() || !form.title.trim() || !form.content.trim()
              }
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
          placeholder="Filter by title/category/tag…"
          className="w-full max-w-md bg-[var(--lain-panel-alt)] border border-[var(--lain-border)] rounded-lg px-3 py-2 text-sm text-[var(--lain-text)] placeholder:text-[var(--lain-muted)] focus:outline-none focus:ring-2 focus:ring-[var(--lain-highlight)]"
        />
      </div>

      {loading ? (
        <p className="px-4 text-sm text-[var(--lain-muted)]">Loading…</p>
      ) : categoryOrder.length === 0 ? (
        <p className="px-4 text-sm text-[var(--lain-muted)]">
          Nothing here yet — add a playbook above (start with the incidents
          you&apos;re most likely to face: phishing, ransomware, account
          compromise).
        </p>
      ) : (
        <div className="flex-1 min-h-0 flex flex-col md:flex-row border-t border-[var(--lain-border)]">
          {/* Column 1: Categories (folders) */}
          <div className="md:w-56 shrink-0 border-b md:border-b-0 md:border-r border-[var(--lain-border)] overflow-y-auto max-h-40 md:max-h-none">
            {categoryOrder.map((category) => {
              const count = tree.get(category).length;
              const active = category === selectedCategory;
              return (
                <div
                  key={category}
                  className={`w-full flex items-center gap-1 pr-1 border-l-2 ${
                    active
                      ? "border-[var(--lain-accent)] bg-[var(--lain-panel-alt)]"
                      : "border-transparent hover:bg-[var(--lain-panel)]"
                  }`}
                >
                  <button
                    type="button"
                    onClick={() => {
                      setSelectedCategory(category);
                      setSelectedId(null);
                      setEditing(false);
                    }}
                    className={`flex-1 min-w-0 flex items-center justify-between gap-2 px-3 py-2 text-left text-sm ${
                      active ? "text-[var(--lain-text)]" : "text-[var(--lain-muted)] hover:text-[var(--lain-text)]"
                    }`}
                  >
                    <span className="truncate">📁 {category}</span>
                    <span className="text-[10px] opacity-60 shrink-0">{count}</span>
                  </button>
                  <a
                    href={downloadUrl({ category })}
                    title={`Export "${category}" as a .zip`}
                    className="shrink-0 text-xs text-[var(--lain-muted)] hover:text-[var(--lain-accent-light)] px-1"
                  >
                    ⬇
                  </a>
                </div>
              );
            })}
          </div>

          {/* Column 2: Titles (files) within the selected category */}
          <div className="md:w-64 shrink-0 border-b md:border-b-0 md:border-r border-[var(--lain-border)] overflow-y-auto max-h-52 md:max-h-none">
            {!selectedCategory ? (
              <p className="p-3 text-xs text-[var(--lain-muted)]">
                ← Select a category folder to see its playbooks.
              </p>
            ) : (
              titlesInCategory.map((e) => {
                const active = e.id === selectedId;
                return (
                  <button
                    key={e.id}
                    type="button"
                    onClick={() => {
                      setSelectedId(e.id);
                      setEditing(false);
                    }}
                    className={`w-full flex items-center gap-2 px-3 py-2 text-left text-sm border-l-2 ${
                      active
                        ? "border-[var(--lain-highlight)] bg-[var(--lain-panel-alt)] text-[var(--lain-text)]"
                        : "border-transparent text-[var(--lain-muted)] hover:bg-[var(--lain-panel)] hover:text-[var(--lain-text)]"
                    }`}
                  >
                    <span className="truncate">📄 {e.title}</span>
                  </button>
                );
              })
            )}
          </div>

          {/* Column 3: Content preview / edit */}
          <div className="flex-1 min-h-0 overflow-y-auto p-4">
            {!selectedEntry ? (
              <p className="text-sm text-[var(--lain-muted)]">
                ← Select a playbook to view its steps.
              </p>
            ) : editing ? (
              <div className="space-y-2 max-w-3xl">
                <div className="grid grid-cols-2 gap-2">
                  <input
                    value={editForm.category}
                    onChange={(e) => setEditForm((f) => ({ ...f, category: e.target.value }))}
                    className="bg-[var(--lain-panel-alt)] border border-[var(--lain-border)] rounded-lg px-3 py-2 text-sm text-[var(--lain-text)] focus:outline-none focus:ring-2 focus:ring-[var(--lain-highlight)]"
                  />
                  <input
                    value={editForm.title}
                    onChange={(e) => setEditForm((f) => ({ ...f, title: e.target.value }))}
                    className="bg-[var(--lain-panel-alt)] border border-[var(--lain-border)] rounded-lg px-3 py-2 text-sm text-[var(--lain-text)] focus:outline-none focus:ring-2 focus:ring-[var(--lain-highlight)]"
                  />
                </div>
                <textarea
                  value={editForm.content}
                  onChange={(e) => setEditForm((f) => ({ ...f, content: e.target.value }))}
                  rows={12}
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
                      {selectedEntry.category}
                    </p>
                    <h2 className="text-base font-semibold text-[var(--lain-text)]">
                      {selectedEntry.title}
                    </h2>
                  </div>
                  <div className="flex gap-2 shrink-0">
                    <a
                      href={downloadUrl({ id: selectedEntry.id })}
                      title="Export this playbook as a .md file"
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
