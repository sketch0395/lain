// Thin shared client for the Ollama chat completions endpoint — used by the
// main chat route (with tool-calling) and by lib/briefing.js (plain
// completion, no tools) for generating proactive briefings.

import { selectToolDefinitions } from "./tools";

export const OLLAMA_HOST = process.env.OLLAMA_HOST || "http://10.5.1.20:11434";
// Regular chat model — fast, always the default.
export const OLLAMA_MODEL = process.env.OLLAMA_MODEL || "gemma4:e4b";
// Larger "deep thinking" model — opt-in per request for tougher questions,
// at the cost of a model swap/reload on the Ollama host (a few seconds)
// since only one model is expected to be loaded at a time on this GPU.
export const OLLAMA_MODEL_DEEP = process.env.OLLAMA_MODEL_DEEP || "gemma4:12b";

const OLLAMA_TIMEOUT_MS = Number(process.env.LAIN_OLLAMA_TIMEOUT_MS) || 90_000;
// The deep-thinking model reasons at length even for simple prompts (it's a
// "thinking" model), so it routinely needs much longer than the default
// timeout — give it its own, longer budget.
const OLLAMA_TIMEOUT_MS_DEEP =
  Number(process.env.LAIN_OLLAMA_TIMEOUT_MS_DEEP) || 300_000;
// Ollama defaults to a 4096-token context window per request unless told
// otherwise — easy to silently overflow once you add the personality
// prompt, tool schemas, profile/memory/tone addenda, and conversation
// history, which truncates input and can produce empty/garbled replies
// with no error. Explicitly request a much larger window (model supports
// up to 128k); override via LAIN_OLLAMA_NUM_CTX if VRAM is tight. Bumped
// from 16384 -> 24576: with ~50 tools now defined, their JSON schemas
// alone were eating over half of a 16k window before the system prompt,
// history, or the user's message were even added. Verified 24576 still
// fits entirely in this laptop's 8GB GPU for the main model (gemma4:e4b).
const OLLAMA_NUM_CTX = Number(process.env.LAIN_OLLAMA_NUM_CTX) || 24576;

// Empirically, small local models (gemma4:e4b) become unreliable at real
// tool-calling well before the context window is actually full — verified
// hitting 0 tool_calls (a fabricated text "success" instead of a real
// function call) at ~16k/24k tokens (65%) in a long-running conversation,
// while the exact same tool schema worked perfectly in isolation at ~200
// tokens. Warn the user well before that zone so they can start a fresh
// chat for reliability-critical actions (saving to threat intel, incident
// reports, etc.) instead of trusting a bloated conversation's tool calls.
export const CONTEXT_WARNING_TOKENS = Math.floor(
  Number(process.env.LAIN_CONTEXT_WARNING_RATIO || 0.45) * OLLAMA_NUM_CTX
);
export { OLLAMA_NUM_CTX };

// Finds the most recent user message in a chat-formatted messages array,
// used to pick which tool categories are relevant for this turn. Scans
// from the end since a retry/follow-up messages array can end with a
// tool-result or assistant message rather than the user's own turn.
function lastUserText(messages) {
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i]?.role === "user") return messages[i].content || "";
  }
  return "";
}

export async function callOllama(messages, useTools, { model } = {}) {
  const timeoutMs =
    model && model === OLLAMA_MODEL_DEEP ? OLLAMA_TIMEOUT_MS_DEEP : OLLAMA_TIMEOUT_MS;
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
        ...(useTools ? { tools: selectToolDefinitions(lastUserText(messages)) } : {}),
      }),
      // Without a timeout, a stalled/overloaded Ollama (e.g. swapping between
      // multiple loaded models) leaves the request hanging indefinitely with
      // no error shown to the user — this turns that into a clean failure.
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (err) {
    if (err.name === "TimeoutError" || err.name === "AbortError") {
      throw new Error(
        `Ollama didn't respond within ${Math.round(timeoutMs / 1000)}s ` +
          `(it may be busy loading/swapping models)`
      );
    }
    throw err;
  }
  if (!res.ok) {
    throw new Error(`Ollama responded with ${res.status}`);
  }
  const json = await res.json();
  if (process.env.LAIN_DEBUG_TOKENS) {
    console.error(
      `[lain][debug-tokens] prompt_eval_count=${json.prompt_eval_count} ` +
        `eval_count=${json.eval_count} num_ctx=${OLLAMA_NUM_CTX} ` +
        `content_len=${(json.message?.content || "").length} ` +
        `tool_calls=${(json.message?.tool_calls || []).length}`
    );
  }
  return json;
}
