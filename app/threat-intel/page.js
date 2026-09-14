"use client";

// Threat Intel library — a dedicated page (not a modal) presented like a
// file directory: Categories are folders, Titles are files inside each
// folder, and Contents render like a file preview pane. There's simply too
// much reference material (kill chain phases, ATT&CK techniques, IOCs,
// mitigations, full write-ups) to fit comfortably in a small popup.
// Lain reads this back via the lookup_threat_intel/add_threat_intel tools;
// this page is the human-curated, browsable side. Talks to /api/threat-intel.

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

const EMPTY_FORM = { category: "", title: "", content: "", tags: "" };

export default function ThreatIntelPage() {
  const [entries, setEntries] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [filter, setFilter] = useState("");
  const [selectedCategory, setSelectedCategory] = useState(null);
  const [selectedId, setSelectedId] = useState(null);
  const [showAddForm, setShowAddForm] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    load();
  }, []);

  async function load() {
    setLoading(true);
    try {
      const res = await fetch("/api/threat-intel");
      const data = await res.json();
      setEntries(data.entries || []);
    } catch {
      setError("Couldn't load the threat intel library.");
    }
    setLoading(false);
  }

  async function addEntry(e) {
    e.preventDefault();
    if (!form.category.trim() || !form.title.trim() || !form.content.trim()) return;
    setSaving(true);
    setError("");
    try {
      const res = await fetch("/api/threat-intel", {
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
      setError("Couldn't save that entry.");
    }
    setSaving(false);
  }

  async function remove(id) {
    setEntries((prev) => prev.filter((e) => e.id !== id));
    if (selectedId === id) setSelectedId(null);
    try {
      await fetch(`/api/threat-intel/${id}`, { method: "DELETE" });
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

  // Keep selection valid as data/filter changes.
  useEffect(() => {
    if (selectedCategory && !tree.has(selectedCategory)) {
      setSelectedCategory(null);
      setSelectedId(null);
    }
  }, [tree, selectedCategory]);

  const titlesInCategory = selectedCategory ? tree.get(selectedCategory) || [] : [];
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
            🛡️ Threat Intel Library
          </h1>
        </div>
        <button
          type="button"
          onClick={() => setShowAddForm((v) => !v)}
          className="rounded-lg bg-[var(--lain-accent)] hover:bg-[var(--lain-accent-light)] px-3 py-1.5 text-sm font-semibold border border-[var(--lain-highlight)]/40 shrink-0"
        >
          {showAddForm ? "Cancel" : "+ New Entry"}
        </button>
      </header>

      <p className="px-4 pt-3 text-xs text-[var(--lain-muted)]">
        Lain's curated cyber threat reference library — kill chain phases,
        attack techniques, IOCs, mitigations, and anything else worth citing
        instead of guessing. Browse it like a file tree: pick a category
        folder, then a title.
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
              placeholder="Category (e.g. kill_chain)"
              list="threat-intel-categories"
              className="bg-[var(--lain-panel-alt)] border border-[var(--lain-border)] rounded-lg px-3 py-2 text-sm text-[var(--lain-text)] placeholder:text-[var(--lain-muted)] focus:outline-none focus:ring-2 focus:ring-[var(--lain-highlight)]"
            />
            <datalist id="threat-intel-categories">
              {categoryOrder.map((c) => (
                <option key={c} value={c} />
              ))}
            </datalist>
            <input
              value={form.title}
              onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
              placeholder="Title (e.g. Reconnaissance)"
              className="bg-[var(--lain-panel-alt)] border border-[var(--lain-border)] rounded-lg px-3 py-2 text-sm text-[var(--lain-text)] placeholder:text-[var(--lain-muted)] focus:outline-none focus:ring-2 focus:ring-[var(--lain-highlight)]"
            />
          </div>
          <textarea
            value={form.content}
            onChange={(e) => setForm((f) => ({ ...f, content: e.target.value }))}
            placeholder="Content / description / indicators / mitigations…"
            rows={4}
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
          Nothing in the library yet — add reference entries above (start
          with the cyber kill chain phases, then expand from there).
        </p>
      ) : (
        <div className="flex-1 min-h-0 flex flex-col md:flex-row border-t border-[var(--lain-border)]">
          {/* Column 1: Categories (folders) */}
          <div className="md:w-56 shrink-0 border-b md:border-b-0 md:border-r border-[var(--lain-border)] overflow-y-auto max-h-40 md:max-h-none">
            {categoryOrder.map((category) => {
              const count = tree.get(category).length;
              const active = category === selectedCategory;
              return (
                <button
                  key={category}
                  type="button"
                  onClick={() => {
                    setSelectedCategory(category);
                    setSelectedId(null);
                  }}
                  className={`w-full flex items-center justify-between gap-2 px-3 py-2 text-left text-sm border-l-2 ${
                    active
                      ? "border-[var(--lain-accent)] bg-[var(--lain-panel-alt)] text-[var(--lain-text)]"
                      : "border-transparent text-[var(--lain-muted)] hover:bg-[var(--lain-panel)] hover:text-[var(--lain-text)]"
                  }`}
                >
                  <span className="truncate">📁 {category}</span>
                  <span className="text-[10px] opacity-60 shrink-0">{count}</span>
                </button>
              );
            })}
          </div>

          {/* Column 2: Titles (files) within the selected category */}
          <div className="md:w-64 shrink-0 border-b md:border-b-0 md:border-r border-[var(--lain-border)] overflow-y-auto max-h-52 md:max-h-none">
            {!selectedCategory ? (
              <p className="p-3 text-xs text-[var(--lain-muted)]">
                ← Select a category folder to see its entries.
              </p>
            ) : (
              titlesInCategory.map((e) => {
                const active = e.id === selectedId;
                return (
                  <button
                    key={e.id}
                    type="button"
                    onClick={() => setSelectedId(e.id)}
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

          {/* Column 3: Content preview */}
          <div className="flex-1 min-h-0 overflow-y-auto p-4">
            {!selectedEntry ? (
              <p className="text-sm text-[var(--lain-muted)]">
                ← Select an entry to view its contents.
              </p>
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
                  <button
                    type="button"
                    onClick={() => remove(selectedEntry.id)}
                    className="text-xs text-[var(--lain-muted)] hover:text-[var(--lain-accent-light)] border border-[var(--lain-border)] rounded-lg px-2 py-1 shrink-0"
                  >
                    Delete
                  </button>
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
