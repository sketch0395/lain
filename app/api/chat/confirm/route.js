// Executes (or cancels) a tool call the model asked to run, once the user
// has approved or denied it in the chat UI. See app/api/chat/route.js for
// where the confirmation request originates.

import { saveMessage } from "@/lib/conversations";
import { describeToolCall, executeTool, parseArgs } from "@/lib/tools";
import { deletePending, getPending } from "@/lib/pendingToolCalls";
import { callOllama, OLLAMA_HOST } from "@/lib/ollama";

export async function POST(request) {
  const { pendingId, approve } = await request.json();

  const pending = getPending(pendingId);
  if (!pending) {
    return Response.json(
      { error: "This request has expired — please ask again." },
      { status: 410 }
    );
  }
  deletePending(pendingId);

  const { conversationId, messages, assistantToolMessage, toolCalls, model } = pending;

  if (!approve) {
    const reply =
      "Okay, I won't do that. Let me know if you'd like to try something else.";
    saveMessage(conversationId, "assistant", reply);
    return Response.json({ reply, conversationId });
  }

  const toolResultMessages = [];
  const summaries = [];
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

  const followUpMessages = [
    ...messages,
    assistantToolMessage,
    ...toolResultMessages,
  ];

  let data;
  try {
    data = await callOllama(followUpMessages, false, { model });
  } catch (err) {
    return Response.json(
      { error: `Could not reach Ollama at ${OLLAMA_HOST}: ${err.message}` },
      { status: 502 }
    );
  }

  const reply = (data.message?.content || "").trim() ||
    "Sorry, I didn't get anything back there — mind trying that again?";
  saveMessage(
    conversationId,
    "assistant",
    `*(${summaries.join("; ")})*\n\n${reply}`
  );
  return Response.json({ reply, conversationId });
}
