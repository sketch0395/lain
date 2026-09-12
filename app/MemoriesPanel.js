"use client";

// Memories panel: shows facts Lain has auto-learned about the user via the
// remember_fact tool (plus lets the user add one manually or delete any
// that are wrong/unwanted). Talks to /api/memories.

import { useEffect, useState } from "react";

export default function MemoriesPanel({ onClose }) {
  const [memories, setMemories] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [newFact, setNewFact] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    load();
  }, []);

  async function load() {
    setLoading(true);
    try {
      const res = await fetch("/api/memories");
      const data = await res.json();
      setMemories(data.memories || []);
    } catch {
      setError("Couldn't load memories.");
    }
    setLoading(false);
  }

  async function addFact(e) {
    e.preventDefault();
    if (!newFact.trim()) return;
    setSaving(true);
    setError("");
    try {
      const res = await fetch("/api/memories", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: newFact.trim() }),
      });
      if (!res.ok) throw new Error("Save failed");
      setNewFact("");
      await load();
    } catch {
      setError("Couldn't save that.");
    }
    setSaving(false);
  }

  async function remove(id) {
    setMemories((prev) => prev.filter((m) => m.id !== id));
    try {
      await fetch(`/api/memories/${id}`, { method: "DELETE" });
    } catch {
      setError("Couldn't delete that — refreshing.");
      load();
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-lg max-h-[85vh] overflow-y-auto bg-[var(--lain-panel)] border border-[var(--lain-gold)]/40 rounded-2xl p-5 space-y-4"
      >
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-bold bg-gradient-to-r from-[var(--lain-crimson-light)] to-[var(--lain-gold-soft)] bg-clip-text text-transparent">
            🧠 Memories
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close memories"
            className="p-1 text-[var(--lain-muted)] hover:text-[var(--lain-cream)]"
          >
            ✕
          </button>
        </div>

        <p className="text-xs text-[var(--lain-muted)]">
          Things Lain has learned about you from conversation. Delete anything
          wrong or that you'd rather she forget.
        </p>

        <form onSubmit={addFact} className="flex gap-2">
          <input
            value={newFact}
            onChange={(e) => setNewFact(e.target.value)}
            placeholder="Add a fact manually…"
            className="flex-1 bg-[var(--lain-panel-alt)] border border-[var(--lain-border)] rounded-lg px-3 py-2 text-sm text-[var(--lain-cream)] placeholder:text-[var(--lain-muted)] focus:outline-none focus:ring-2 focus:ring-[var(--lain-gold)]"
          />
          <button
            type="submit"
            disabled={saving || !newFact.trim()}
            className="rounded-lg bg-[var(--lain-crimson)] hover:bg-[var(--lain-crimson-light)] px-3 py-2 text-sm font-semibold border border-[var(--lain-gold)]/40 disabled:opacity-50"
          >
            Add
          </button>
        </form>

        {error && <p className="text-xs text-[var(--lain-crimson-light)]">{error}</p>}

        {loading ? (
          <p className="text-sm text-[var(--lain-muted)]">Loading…</p>
        ) : memories.length === 0 ? (
          <p className="text-sm text-[var(--lain-muted)]">
            Nothing remembered yet — Lain will save things naturally as you chat.
          </p>
        ) : (
          <div className="space-y-2">
            {memories.map((m) => (
              <div
                key={m.id}
                className="flex items-start justify-between gap-2 border border-[var(--lain-border)] rounded-lg p-2"
              >
                <p className="text-sm text-[var(--lain-cream)] flex-1">{m.content}</p>
                <button
                  type="button"
                  onClick={() => remove(m.id)}
                  aria-label="Forget this"
                  className="text-[var(--lain-muted)] hover:text-[var(--lain-crimson-light)] px-1"
                >
                  ✕
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
