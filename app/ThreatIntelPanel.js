"use client";

// Threat Intel panel: shows what's currently in Lain's curated cyber threat
// reference library (kill chain phases, attack techniques, IOCs,
// mitigations, etc.) so the user can see what she has on hand and decide
// what to add next. Lets the user add/delete entries manually. Lain reads
// this back via the lookup_threat_intel tool — this panel is the
// human-curated side. Talks to /api/threat-intel.

import { useEffect, useMemo, useState } from "react";

const EMPTY_FORM = { category: "", title: "", content: "", tags: "" };

export default function ThreatIntelPanel({ onClose }) {
  const [entries, setEntries] = useState([]);
  const [categories, setCategories] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [form, setForm] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [filter, setFilter] = useState("");

  useEffect(() => {
    load();
  }, []);

  async function load() {
    setLoading(true);
    try {
      const res = await fetch("/api/threat-intel");
      const data = await res.json();
      setEntries(data.entries || []);
      setCategories(data.categories || []);
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
      setForm(EMPTY_FORM);
      await load();
    } catch {
      setError("Couldn't save that entry.");
    }
    setSaving(false);
  }

  async function remove(id) {
    setEntries((prev) => prev.filter((e) => e.id !== id));
    try {
      await fetch(`/api/threat-intel/${id}`, { method: "DELETE" });
    } catch {
      setError("Couldn't delete that — refreshing.");
      load();
    }
  }

  const grouped = useMemo(() => {
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
    return byCategory;
  }, [entries, filter]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-2xl max-h-[85vh] overflow-y-auto bg-[var(--lain-panel)] border border-[var(--lain-highlight)]/40 rounded-2xl p-5 space-y-4"
      >
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-bold bg-gradient-to-r from-[var(--lain-accent-light)] to-[var(--lain-highlight-soft)] bg-clip-text text-transparent">
            🛡️ Threat Intel
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close threat intel"
            className="p-1 text-[var(--lain-muted)] hover:text-[var(--lain-text)]"
          >
            ✕
          </button>
        </div>

        <p className="text-xs text-[var(--lain-muted)]">
          Lain's curated cyber threat reference library — kill chain phases,
          attack techniques, IOCs, mitigations, and anything else worth her
          citing instead of guessing. She looks this up via
          lookup_threat_intel; add/remove entries here.
        </p>

        <form onSubmit={addEntry} className="space-y-2 border border-[var(--lain-border)] rounded-lg p-3">
          <div className="grid grid-cols-2 gap-2">
            <input
              value={form.category}
              onChange={(e) => setForm((f) => ({ ...f, category: e.target.value }))}
              placeholder="Category (e.g. kill_chain)"
              list="threat-intel-categories"
              className="bg-[var(--lain-panel-alt)] border border-[var(--lain-border)] rounded-lg px-3 py-2 text-sm text-[var(--lain-text)] placeholder:text-[var(--lain-muted)] focus:outline-none focus:ring-2 focus:ring-[var(--lain-highlight)]"
            />
            <datalist id="threat-intel-categories">
              {categories.map((c) => (
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
            rows={3}
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
              Add
            </button>
          </div>
        </form>

        <input
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="Filter by title/category/tag…"
          className="w-full bg-[var(--lain-panel-alt)] border border-[var(--lain-border)] rounded-lg px-3 py-2 text-sm text-[var(--lain-text)] placeholder:text-[var(--lain-muted)] focus:outline-none focus:ring-2 focus:ring-[var(--lain-highlight)]"
        />

        {error && <p className="text-xs text-[var(--lain-accent-light)]">{error}</p>}

        {loading ? (
          <p className="text-sm text-[var(--lain-muted)]">Loading…</p>
        ) : grouped.size === 0 ? (
          <p className="text-sm text-[var(--lain-muted)]">
            Nothing in the library yet — add reference entries above (start
            with the cyber kill chain phases, then expand from there).
          </p>
        ) : (
          <div className="space-y-4">
            {[...grouped.entries()].map(([category, items]) => (
              <div key={category} className="space-y-2">
                <h3 className="text-xs font-semibold uppercase tracking-wide text-[var(--lain-muted)]">
                  {category} ({items.length})
                </h3>
                {items.map((e) => (
                  <div
                    key={e.id}
                    className="flex items-start justify-between gap-2 border border-[var(--lain-border)] rounded-lg p-2"
                  >
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-[var(--lain-text)]">{e.title}</p>
                      <p className="text-xs text-[var(--lain-muted)] whitespace-pre-wrap">
                        {e.content}
                      </p>
                      {e.tags && (
                        <p className="text-[10px] text-[var(--lain-muted)] mt-1 italic">
                          {e.tags}
                        </p>
                      )}
                    </div>
                    <button
                      type="button"
                      onClick={() => remove(e.id)}
                      aria-label="Delete entry"
                      className="text-[var(--lain-muted)] hover:text-[var(--lain-accent-light)] px-1"
                    >
                      ✕
                    </button>
                  </div>
                ))}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
