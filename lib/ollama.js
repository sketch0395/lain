// Thin shared client for the Ollama chat completions endpoint — used by the
// main chat route (with tool-calling) and by lib/briefing.js (plain
// completion, no tools) for generating proactive briefings.

import { getToolDefinitions } from "./tools";

export const OLLAMA_HOST = process.env.OLLAMA_HOST || "http://10.5.1.20:11434";
// Regular chat model — fast, always the default.
export const OLLAMA_MODEL = process.env.OLLAMA_MODEL || "gemma4:e4b";
// Larger "deep thinking" model — opt-in per request for tougher questions,
// at the cost of a model swap/reload on the Ollama host (a few seconds)
// since only one model is expected to be loaded at a time on this GPU.
export const OLLAMA_MODEL_DEEP = process.env.OLLAMA_MODEL_DEEP || "gemma4:12b";

const OLLAMA_TIMEOUT_MS = Number(process.env.LAIN_OLLAMA_TIMEOUT_MS) || 90_000;
// Ollama defaults to a 4096-token context window per request unless told
// otherwise — easy to silently overflow once you add the personality
// prompt, tool schemas, profile/memory/tone addenda, and conversation
// history, which truncates input and can produce empty/garbled replies
// with no error. Explicitly request a much larger window (model supports
// up to 128k); override via LAIN_OLLAMA_NUM_CTX if VRAM is tight.
const OLLAMA_NUM_CTX = Number(process.env.LAIN_OLLAMA_NUM_CTX) || 16384;

export async function callOllama(messages, useTools, { model } = {}) {
  let res;
  try {
    res = await fetch(`${OLLAMA_HOST}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: model || OLLAMA_MODEL,
        messages,
        stream: false,
        options: { num_ctx: OLLAMA_NUM_CTX },
        ...(useTools ? { tools: getToolDefinitions() } : {}),
      }),
      // Without a timeout, a stalled/overloaded Ollama (e.g. swapping between
      // multiple loaded models) leaves the request hanging indefinitely with
      // no error shown to the user — this turns that into a clean failure.
      signal: AbortSignal.timeout(OLLAMA_TIMEOUT_MS),
    });
  } catch (err) {
    if (err.name === "TimeoutError" || err.name === "AbortError") {
      throw new Error(
        `Ollama didn't respond within ${Math.round(OLLAMA_TIMEOUT_MS / 1000)}s ` +
          `(it may be busy loading/swapping models)`
      );
    }
    throw err;
  }
  if (!res.ok) {
    throw new Error(`Ollama responded with ${res.status}`);
  }
  return res.json();
}
