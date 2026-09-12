"use client";

// "Enable live packet capture" flow — reachable from Settings ("🛡️ Enable
// packet capture"). Deliberately separate from the chat conversation: the
// sudo password entered here is sent directly to /api/tools/grant-capture-
// permission (which forwards it straight to the local tools agent and
// discards it) and never becomes a tool-call argument, never enters chat
// history, and is never seen by the Ollama model. See
// app/api/tools/grant-capture-permission/route.js and
// tools-agent/lib/capabilities.js for the rest of this flow.

import { useState } from "react";

export default function GrantCapturePermissionModal({ onClose }) {
  const [password, setPassword] = useState("");
  const [step, setStep] = useState("form"); // form -> success
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function submit(e) {
    e.preventDefault();
    if (!password) return;
    setSubmitting(true);
    setError("");
    try {
      const res = await fetch("/api/tools/grant-capture-permission", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });
      const data = await res.json();
      // Clear the password from memory immediately either way — it's only
      // ever needed for this one request.
      setPassword("");
      if (!res.ok) {
        setError(data.error || "Something went wrong.");
        setSubmitting(false);
        return;
      }
      setStep("success");
    } catch {
      setPassword("");
      setError("Couldn't reach the server — try again.");
      setSubmitting(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
      onClick={step === "success" ? undefined : onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-sm bg-[var(--lain-panel)] border border-[var(--lain-highlight)]/40 rounded-2xl p-5 space-y-4 text-center"
      >
        {step === "form" && (
          <form onSubmit={submit} className="space-y-3">
            <h2 className="text-lg font-bold text-[var(--lain-text)]">
              Enable live packet capture
            </h2>
            <p className="text-sm text-[var(--lain-muted)]">
              Grants tcpdump permission to capture live traffic
              (cap_net_raw/cap_net_admin) so Lain&apos;s capture_packets tool can
              run without root. Your password is sent directly to the tools
              agent on this machine to run one fixed command, then
              discarded — it&apos;s never stored, logged, or shown to Lain.
            </p>
            <input
              type="password"
              autoFocus
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full bg-[var(--lain-panel-alt)] border border-[var(--lain-border)] rounded-lg px-3 py-2 text-[var(--lain-text)] focus:outline-none focus:ring-2 focus:ring-[var(--lain-highlight)]"
              placeholder="sudo password"
            />
            {error && <p className="text-xs text-[var(--lain-accent-light)]">{error}</p>}
            <div className="flex gap-2 pt-1">
              <button
                type="button"
                onClick={onClose}
                className="flex-1 rounded-lg border border-[var(--lain-border)] py-2 text-sm text-[var(--lain-muted)] hover:text-[var(--lain-text)]"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={!password || submitting}
                className="flex-1 rounded-lg bg-[var(--lain-accent)] hover:bg-[var(--lain-accent-light)] py-2 text-sm font-semibold border border-[var(--lain-highlight)]/40 disabled:opacity-50"
              >
                {submitting ? "Granting…" : "Grant"}
              </button>
            </div>
          </form>
        )}

        {step === "success" && (
          <>
            <div className="w-full py-10 rounded-xl border border-[var(--lain-highlight)]/40 text-5xl">
              ✅
            </div>
            <h2 className="text-xl font-bold bg-gradient-to-r from-[var(--lain-accent-light)] to-[var(--lain-highlight-soft)] bg-clip-text text-transparent">
              Permission granted
            </h2>
            <p className="text-sm text-[var(--lain-muted)]">
              tcpdump can now capture live traffic. Ask Lain to capture
              packets whenever you like.
            </p>
            <button
              type="button"
              onClick={onClose}
              className="w-full rounded-lg bg-[var(--lain-accent)] hover:bg-[var(--lain-accent-light)] py-2 text-sm font-semibold border border-[var(--lain-highlight)]/40"
            >
              OK
            </button>
          </>
        )}
      </div>
    </div>
  );
}
