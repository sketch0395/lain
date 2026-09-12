"use client";

// "Wipe All Memory" flow — reachable from Settings ("🗑️ Wipe All Memory")
// or by typing the chat command (see WIPE_PHRASE in ChatClient.js). Requires
// a confirm step plus a 4-digit PIN before permanently deleting every fact
// Lain has learned via the remember_fact tool (does not touch the About
// Me profile or conversation history). Ends with an "All Clear" screen.

import { useState } from "react";

export default function WipeMemoryModal({ onClose, onWiped }) {
  const [step, setStep] = useState("confirm"); // confirm -> pin -> allclear
  const [pin, setPin] = useState("");
  const [error, setError] = useState("");
  const [wiping, setWiping] = useState(false);

  async function submitPin(e) {
    e.preventDefault();
    if (pin.length !== 4) return;
    setWiping(true);
    setError("");
    try {
      const res = await fetch("/api/memories", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pin }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Something went wrong.");
        setPin("");
        setWiping(false);
        return;
      }
      onWiped?.();
      setStep("allclear");
    } catch {
      setError("Couldn't reach the server — try again.");
      setWiping(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
      onClick={step === "allclear" ? undefined : onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-sm bg-[var(--lain-panel)] border border-[var(--lain-gold)]/40 rounded-2xl p-5 space-y-4 text-center"
      >
        {step === "confirm" && (
          <>
            <h2 className="text-lg font-bold text-[var(--lain-cream)]">
              Wipe All Memory?
            </h2>
            <p className="text-sm text-[var(--lain-muted)]">
              This permanently erases everything Lain has learned and
              remembered about you, plus every conversation/chat history. It
              won't touch your About Me profile. This can't be undone.
            </p>
            <div className="flex gap-2 pt-1">
              <button
                type="button"
                onClick={onClose}
                className="flex-1 rounded-lg border border-[var(--lain-border)] py-2 text-sm text-[var(--lain-muted)] hover:text-[var(--lain-cream)]"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => setStep("pin")}
                className="flex-1 rounded-lg bg-[var(--lain-crimson)] hover:bg-[var(--lain-crimson-light)] py-2 text-sm font-semibold border border-[var(--lain-gold)]/40"
              >
                Continue
              </button>
            </div>
          </>
        )}

        {step === "pin" && (
          <form onSubmit={submitPin} className="space-y-3">
            <h2 className="text-lg font-bold text-[var(--lain-cream)]">
              Enter PIN to confirm
            </h2>
            <p className="text-sm text-[var(--lain-muted)]">
              Enter the 4-digit PIN to wipe all memory.
            </p>
            <input
              type="password"
              inputMode="numeric"
              pattern="[0-9]*"
              maxLength={4}
              autoFocus
              value={pin}
              onChange={(e) => setPin(e.target.value.replace(/\D/g, "").slice(0, 4))}
              className="w-full text-center tracking-[0.5em] text-xl bg-[var(--lain-panel-alt)] border border-[var(--lain-border)] rounded-lg px-3 py-2 text-[var(--lain-cream)] focus:outline-none focus:ring-2 focus:ring-[var(--lain-gold)]"
              placeholder="••••"
            />
            {error && (
              <p className="text-xs text-[var(--lain-crimson-light)]">{error}</p>
            )}
            <div className="flex gap-2 pt-1">
              <button
                type="button"
                onClick={onClose}
                className="flex-1 rounded-lg border border-[var(--lain-border)] py-2 text-sm text-[var(--lain-muted)] hover:text-[var(--lain-cream)]"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={pin.length !== 4 || wiping}
                className="flex-1 rounded-lg bg-[var(--lain-crimson)] hover:bg-[var(--lain-crimson-light)] py-2 text-sm font-semibold border border-[var(--lain-gold)]/40 disabled:opacity-50"
              >
                {wiping ? "Wiping…" : "Confirm"}
              </button>
            </div>
          </form>
        )}

        {step === "allclear" && (
          <>
            <div className="w-full py-10 rounded-xl border border-[var(--lain-gold)]/40 text-5xl">
              ✅
            </div>
            <h2 className="text-xl font-bold bg-gradient-to-r from-[var(--lain-crimson-light)] to-[var(--lain-gold-soft)] bg-clip-text text-transparent">
              All Clear
            </h2>
            <button
              type="button"
              onClick={onClose}
              className="w-full rounded-lg bg-[var(--lain-crimson)] hover:bg-[var(--lain-crimson-light)] py-2 text-sm font-semibold border border-[var(--lain-gold)]/40"
            >
              OK
            </button>
          </>
        )}
      </div>
    </div>
  );
}
