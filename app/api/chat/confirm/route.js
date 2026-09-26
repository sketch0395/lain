// Executes (or cancels) a tool call the model asked to run, once the user
// has approved or denied it in the chat UI. See app/api/chat/route.js for
// where the confirmation request originates.

import { loadHistory, maybeCompactHistory, saveMessage } from "@/lib/conversations";
import { describeToolCall } from "@/lib/tools";
import { deletePending, getPending } from "@/lib/pendingToolCalls";
import { runToolLoop } from "@/lib/toolLoop";
import { OLLAMA_HOST, CONTEXT_WARNING_TOKENS } from "@/lib/ollama";
import { streamJsonResponse } from "@/lib/streamJson";

function isContextHeavy(promptEvalCount) {
  return typeof promptEvalCount === "number" && promptEvalCount >= CONTEXT_WARNING_TOKENS;
}

// Extracted out of POST() so it can run inside streamJsonResponse()'s
// ReadableStream — see lib/streamJson.js and app/api/chat/route.js's
// handleChat() for why. Returns a plain JSON-able payload; internal error
// paths return an { error } payload instead of a distinct HTTP status
// since the outer response is already committed (200, streaming).
async function handleConfirm({ pendingId, approve }) {
  const pending = getPending(pendingId);
  if (!pending) {
    return { error: "This request has expired — please ask again." };
  }
  deletePending(pendingId);

  const { conversationId, messages, assistantToolMessage, toolCalls, model } = pending;

  if (!approve) {
    const reply =
      "Okay, I won't do that. Let me know if you'd like to try something else.";
    saveMessage(conversationId, "assistant", reply);
    return { reply, conversationId };
  }

  // `messages` is the snapshot captured when the tool call was first proposed.
  // If another device (or tab) sent a new message to this same conversation
  // while this confirmation sat pending, that snapshot is now stale. Re-pull
  // the conversation history fresh from the DB so the follow-up completion
  // sees everything that's actually happened, and only fall back to the
  // stale snapshot's leading system message (position 0), which doesn't
  // depend on other devices.
  const systemMessage = messages[0]?.role === "system" ? [messages[0]] : [];
  const freshHistory = loadHistory(conversationId);
  const freshMessages = [...systemMessage, ...freshHistory];

  let loopResult;
  try {
    loopResult = await runToolLoop({
      messages: freshMessages,
      model,
      conversationId,
      firstRound: { assistantMessage: assistantToolMessage, toolCalls },
    });
  } catch (err) {
    return { error: `Could not reach Ollama at ${OLLAMA_HOST}: ${err.message}` };
  }

  // The approved tool(s) may have led the model to request *another* tool
  // call that itself needs confirmation (e.g. a read-only lookup followed
  // by a write) — surface that the same way the main chat route does
  // instead of silently dropping it.
  if (loopResult.needsConfirmation) {
    return {
      conversationId,
      needsConfirmation: true,
      pendingId: loopResult.pendingId,
      contextWarning: isContextHeavy(loopResult.promptEvalCount),
      toolCalls: loopResult.toolCalls.map((tc) => ({
        name: tc.function?.name,
        arguments: tc.function?.arguments,
        description: describeToolCall(tc.function?.name, tc.function?.arguments),
      })),
    };
  }

  const reply = loopResult.content.trim() ||
    "Sorry, I didn't get anything back there — mind trying that again?";
  saveMessage(
    conversationId,
    "assistant",
    `*(${loopResult.summaries.join("; ")})*\n\n${reply}`
  );
  // Fire-and-forget: fold older history into a recap if this conversation
  // has grown long enough (see maybeCompactHistory). Never awaited so it
  // can't add latency to this response.
  maybeCompactHistory(conversationId).catch(() => {});
  return { reply, conversationId, contextWarning: isContextHeavy(loopResult.promptEvalCount) };
}

export async function POST(request) {
  const { pendingId, approve } = await request.json();
  return streamJsonResponse(() => handleConfirm({ pendingId, approve }));
}
