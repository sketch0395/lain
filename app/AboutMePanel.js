"use client";

// "About Me" panel: lets the user tell Lain who they are (name, birthday,
// occupation, links, etc.) so she can personalize replies. Talks to
// /api/profile. Opened from the Settings menu.

import { useEffect, useState } from "react";

function emptyForm() {
  return {
    name: "",
    birthday: "",
    occupation: "",
    location: "",
    about: "",
    portfolio_url: "",
    linkedin_url: "",
    github_url: "",
  };
}

export default function AboutMePanel({ onClose }) {
  const [form, setForm] = useState(emptyForm());
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/profile");
        const data = await res.json();
        setForm({ ...emptyForm(), ...(data.profile || {}) });
      } catch {
        setError("Couldn't load your profile.");
      }
      setLoading(false);
    })();
  }, []);

  async function submit(e) {
    e.preventDefault();
    setSaving(true);
    setError("");
    setSaved(false);
    try {
      const res = await fetch("/api/profile", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      if (!res.ok) throw new Error("Save failed");
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch {
      setError("Couldn't save your profile.");
    }
    setSaving(false);
  }

  const field = (key, label, placeholder, extra = {}) => (
    <label className="block space-y-1">
      <span className="text-xs uppercase tracking-wide text-[var(--lain-muted)]">
        {label}
      </span>
      <input
        value={form[key]}
        onChange={(e) => setForm({ ...form, [key]: e.target.value })}
        placeholder={placeholder}
        className="w-full bg-[var(--lain-panel-alt)] border border-[var(--lain-border)] rounded-lg px-3 py-2 text-sm text-[var(--lain-text)] placeholder:text-[var(--lain-muted)] focus:outline-none focus:ring-2 focus:ring-[var(--lain-highlight)]"
        {...extra}
      />
    </label>
  );

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
            👤 About Me
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close about me"
            className="p-1 text-[var(--lain-muted)] hover:text-[var(--lain-text)]"
          >
            ✕
          </button>
        </div>

        <p className="text-xs text-[var(--lain-muted)]">
          Tell Lain a bit about yourself. She'll use whatever you fill in
          here to personalize her replies — leave anything blank to skip it.
        </p>

        {loading ? (
          <p className="text-sm text-[var(--lain-muted)]">Loading…</p>
        ) : (
          <form onSubmit={submit} className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              {field("name", "Name", "Your name")}
              {field("birthday", "Birthday", "YYYY-MM-DD", { type: "date" })}
            </div>
            <div className="grid grid-cols-2 gap-3">
              {field("occupation", "Occupation", "e.g. Software engineer")}
              {field("location", "Location", "e.g. Chicago, IL")}
            </div>

            <label className="block space-y-1">
              <span className="text-xs uppercase tracking-wide text-[var(--lain-muted)]">
                About
              </span>
              <textarea
                value={form.about}
                onChange={(e) => setForm({ ...form, about: e.target.value })}
                placeholder="Anything else worth knowing — interests, goals, projects…"
                rows={3}
                className="w-full bg-[var(--lain-panel-alt)] border border-[var(--lain-border)] rounded-lg px-3 py-2 text-sm text-[var(--lain-text)] placeholder:text-[var(--lain-muted)] focus:outline-none focus:ring-2 focus:ring-[var(--lain-highlight)]"
              />
            </label>

            {field("portfolio_url", "Portfolio", "https://…")}
            {field("linkedin_url", "LinkedIn", "https://linkedin.com/in/…")}
            {field("github_url", "GitHub", "https://github.com/…")}

            {error && <p className="text-xs text-[var(--lain-accent-light)]">{error}</p>}

            <div className="flex items-center gap-2 pt-1">
              <button
                type="submit"
                disabled={saving}
                className="flex-1 rounded-lg bg-[var(--lain-accent)] hover:bg-[var(--lain-accent-light)] py-2 text-sm font-semibold border border-[var(--lain-highlight)]/40 disabled:opacity-50"
              >
                {saving ? "Saving…" : "Save"}
              </button>
              {saved && <span className="text-xs text-[var(--lain-highlight-soft)]">Saved ✓</span>}
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
