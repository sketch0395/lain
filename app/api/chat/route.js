import {
  ensureConversation,
  loadHistory,
  maybeSetTitle,
  saveMessage,
} from "@/lib/conversations";
import {
  describeToolCall,
  executeTool,
  parseArgs,
  requiresConfirmation,
  toolsConfigured,
} from "@/lib/tools";
import { createPending } from "@/lib/pendingToolCalls";
import { profilePromptAddendum } from "@/lib/profile";
import { memoryPromptAddendum } from "@/lib/memory";
import { callOllama, OLLAMA_HOST, OLLAMA_MODEL_DEEP } from "@/lib/ollama";
import { detectTone } from "@/lib/tone";

const TIMEZONE = process.env.LAIN_TIMEZONE || "America/Chicago";

// Personality is intentionally blank here — this is a stripped-down base
// template (renamed from an earlier project) with the romantic/companion
// character removed. Both prompts are plain and neutral; define an actual
// personality later via LAIN_SYSTEM_PROMPT or by editing these directly.
const PERSONALITY_PROMPT =
  process.env.LAIN_SYSTEM_PROMPT ||
  "You are Lain, the user's personal AI assistant. Be warm, clear, and " +
    "genuinely helpful. Keep responses concise unless asked for more detail.";

// Personality off: a plain, efficient assistant with no character flourish.
const NEUTRAL_PROMPT =
  process.env.LAIN_NEUTRAL_PROMPT ||
  "You are Lain, a helpful, direct personal AI assistant. Answer clearly " +
    "and efficiently. Do not add personality flourishes or jokes — stay " +
    "strictly professional and to the point.";

const TOOLS_PROMPT_ADDENDUM_BASE =
  "\n\nYou can create reminders for the user (one-time or recurring) and " +
  "fetch current news headlines. When creating a reminder, always compute " +
  "run_at as an absolute local date-time (YYYY-MM-DDTHH:MM:SS) based on the " +
  "current date/time given below and the user's request. Be proactive: if " +
  "the user mentions a concrete task, deadline, or appointment in " +
  "conversation — even if they didn't explicitly ask to be reminded — go " +
  "ahead and call create_reminder for it (the user will always be asked to " +
  "confirm or deny before it's actually created, so it's safe to suggest). " +
  "Don't do this for vague or trivial mentions, only clear, concrete, time-" +
  "bound items. Don't use tools for general conversation otherwise.\n\n" +
  "You also have a remember_fact tool to save durable facts " +
  "about the user for future conversations (preferences, important dates, " +
  "ongoing projects, habits, things they care about). Use it proactively " +
  "and silently whenever the user shares something worth remembering long-" +
  "term — don't ask permission first, and don't announce that you saved it " +
  "unless it fits naturally. Do NOT use it for trivial or one-off details.";

const LAPTOP_TOOLS_PROMPT_ADDENDUM =
  "\n\nYou also have tools to check things on the user's laptop (system " +
  "diagnostics, finding files, searching file contents, reading a file). " +
  "Only use them when the user is actually asking about their computer or " +
  "files.";

function currentTimeAddendum() {
  const now = new Date();
  // "sv-SE" locale formats as "YYYY-MM-DD HH:MM:SS", a convenient ISO-ish base.
  const local = now.toLocaleString("sv-SE", { timeZone: TIMEZONE }).replace(" ", "T");
  return `\n\nCurrent date/time: ${local} (timezone: ${TIMEZONE}).`;
}

// Ollama can occasionally return an empty completion (context overflow,
// model hiccup, etc.) with a 200 status — no error to catch, just nothing
// to say. Rather than silently rendering a blank message bubble, log it
// (for diagnosis) and show the user something actionable.
function emptyReplyFallback(convId, stage) {
  console.error(`[lain] empty completion from Ollama (conversation ${convId}, ${stage} stage)`);
  return "Sorry, I didn't get anything back there — mind trying that again?";
}

export async function POST(request) {
  const { message, conversationId, personality, deepThinking } = await request.json();

  if (!message || typeof message !== "string") {
    return Response.json({ error: "message is required" }, { status: 400 });
  }

  // Reminders/news are always available; laptop diagnostics/file tools only
  // when the tools agent is configured.
  const useTools = true;
  const model = deepThinking ? OLLAMA_MODEL_DEEP : undefined;
  const tone = detectTone(message);
  let systemPrompt = personality === false ? NEUTRAL_PROMPT : PERSONALITY_PROMPT;
  systemPrompt += TOOLS_PROMPT_ADDENDUM_BASE;
  if (toolsConfigured()) systemPrompt += LAPTOP_TOOLS_PROMPT_ADDENDUM;
  systemPrompt += currentTimeAddendum();
  systemPrompt += profilePromptAddendum();
  systemPrompt += memoryPromptAddendum();
  if (personality !== false) systemPrompt += tone.addendum;

  const convId = ensureConversation(conversationId);
  saveMessage(convId, "user", message);
  maybeSetTitle(convId, message);

  const history = loadHistory(convId);
  const messages = [{ role: "system", content: systemPrompt }, ...history];

  let data;
  try {
    data = await callOllama(messages, useTools, { model });
  } catch (err) {
    return Response.json(
      {
        error: `Could not reach Ollama at ${OLLAMA_HOST}: ${err.message}`,
      },
      { status: 502 }
    );
  }

  const toolCalls = data.message?.tool_calls;
  if (useTools && Array.isArray(toolCalls) && toolCalls.length > 0) {
    const anyNeedsConfirm = toolCalls.some((tc) => requiresConfirmation(tc.function?.name));

    if (!anyNeedsConfirm) {
      // All requested tools are read-only lookups (list_reminders, get_news)
      // — run them immediately, no confirmation needed.
      const toolResultMessages = [];
      const summaries = [];
      for (const tc of toolCalls) {
        const name = tc.function?.name;
        const args = parseArgs(tc.function?.arguments);
        let content;
        try {
          const result = await executeTool(name, args, { conversationId: convId });
          content = JSON.stringify(result);
        } catch (err) {
          content = JSON.stringify({ error: err.message });
        }
        summaries.push(describeToolCall(name, args));
        toolResultMessages.push({ role: "tool", content });
      }

      const followUp = [...messages, data.message, ...toolResultMessages];
      let data2;
      try {
        data2 = await callOllama(followUp, false, { model });
      } catch (err) {
        return Response.json(
          { error: `Could not reach Ollama at ${OLLAMA_HOST}: ${err.message}` },
          { status: 502 }
        );
      }
      const reply2 =
        (data2.message?.content || "").trim() ||
        emptyReplyFallback(convId, "follow-up");
      saveMessage(convId, "assistant", reply2);
      return Response.json({
        reply: reply2,
        conversationId: convId,
        tone: { label: tone.label, emoji: tone.emoji, hint: tone.hint },
        model: model || undefined,
      });
    }

    const pendingId = createPending({
      conversationId: convId,
      messages,
      assistantToolMessage: data.message,
      toolCalls,
      model,
    });
    return Response.json({
      conversationId: convId,
      needsConfirmation: true,
      pendingId,
      tone: { label: tone.label, emoji: tone.emoji, hint: tone.hint },
      toolCalls: toolCalls.map((tc) => ({
        name: tc.function?.name,
        arguments: tc.function?.arguments,
        description: describeToolCall(tc.function?.name, tc.function?.arguments),
      })),
    });
  }

  const reply = (data.message?.content || "").trim() || emptyReplyFallback(convId, "main");
  saveMessage(convId, "assistant", reply);

  return Response.json({
    reply,
    conversationId: convId,
    tone: { label: tone.label, emoji: tone.emoji, hint: tone.hint },
    model: model || undefined,
  });
}
