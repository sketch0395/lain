// Runs the model-driven tool-calling loop shared by the main chat route and
// the post-confirmation follow-up.
//
// Previously, only a single round of tool calls was ever allowed: the model
// could call a tool once, but the follow-up completion that fed the result
// back was made with tools disabled — so if the model needed a *second*
// tool call chained off the first (e.g. lookup_obsidian_note to find a
// note's path, then read_obsidian_note to actually fetch it), it had no way
// to make that call. It could only narrate what it intended to do next
// ("let me pull up the full content...") and stop, leaving the user to ask
// again — which repeated the same dead end forever.
//
// This loop keeps tools available on every round, so the model can chain as
// many tool calls as it actually needs in one turn, stopping only when it
// returns plain text, when a tool needs the user's explicit confirmation, or
// after MAX_TOOL_ROUNDS as a safety net against runaway tool-calling loops.

import { describeToolCall, executeTool, parseArgs, requiresConfirmation } from "@/lib/tools";
import { callOllama } from "@/lib/ollama";
import { createPending } from "@/lib/pendingToolCalls";

const MAX_TOOL_ROUNDS = Number(process.env.LAIN_MAX_TOOL_ROUNDS) || 4;

/**
 * @param {object} opts
 * @param {Array} opts.messages - Full messages array, including the leading
 *   system message, ending at the last real user/tool message (i.e. NOT yet
 *   including a model response for this turn).
 * @param {string|undefined} opts.model
 * @param {string} opts.conversationId
 * @param {{assistantMessage: object, toolCalls: Array}} [opts.firstRound] -
 *   If given, skip the first Ollama call and execute these already-decided
 *   (and now user-approved) tool calls immediately, then continue the loop
 *   from there. Used by the confirm route after the user approves.
 * @returns {Promise<
 *   { done: true, content: string, summaries: string[], hitRoundCap?: boolean }
 *   | { needsConfirmation: true, pendingId: string, toolCalls: Array }
 * >}
 */
export async function runToolLoop({ messages, model, conversationId, firstRound }) {
  let currentMessages = messages;
  const summaries = [];
  let pending = firstRound || null;
  let lastPromptEvalCount;

  for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
    let assistantMessage;
    let toolCalls;

    if (pending) {
      assistantMessage = pending.assistantMessage;
      toolCalls = pending.toolCalls;
      pending = null;
    } else {
      const data = await callOllama(currentMessages, true, { model });
      assistantMessage = data.message;
      toolCalls = data.message?.tool_calls;
      lastPromptEvalCount = data.prompt_eval_count;

      if (!Array.isArray(toolCalls) || toolCalls.length === 0) {
        return { done: true, content: data.message?.content || "", summaries, promptEvalCount: lastPromptEvalCount };
      }

      const anyNeedsConfirm = toolCalls.some((tc) => requiresConfirmation(tc.function?.name));
      if (anyNeedsConfirm) {
        const pendingId = createPending({
          conversationId,
          messages: currentMessages,
          assistantToolMessage: assistantMessage,
          toolCalls,
          model,
        });
        return { needsConfirmation: true, pendingId, toolCalls, promptEvalCount: lastPromptEvalCount };
      }
    }

    const toolResultMessages = [];
    for (const tc of toolCalls) {
      const name = tc.function?.name;
      const args = parseArgs(tc.function?.arguments);
      let content;
      try {
        const result = await executeTool(name, args, { conversationId });
        content = JSON.stringify(result);
      } catch (err) {
        content = JSON.stringify({ error: err.message });
      }
      summaries.push(describeToolCall(name, args));
      toolResultMessages.push({ role: "tool", content });
    }

    currentMessages = [...currentMessages, assistantMessage, ...toolResultMessages];
  }

  // Hit the round cap without the model settling on a final text answer —
  // still return whatever tool results we gathered rather than silently
  // dropping them, so at least the summaries show up in the reply.
  return { done: true, content: "", summaries, hitRoundCap: true, promptEvalCount: lastPromptEvalCount };
}
