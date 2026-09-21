import {
  ensureConversation,
  loadHistory,
  maybeCompactHistory,
  maybeSetTitle,
  saveMessage,
} from "@/lib/conversations";
import {
  describeToolCall,
  getToolDefinitions,
  requiresConfirmation,
  toolsConfigured,
} from "@/lib/tools";
import { createPending } from "@/lib/pendingToolCalls";
import { runToolLoop } from "@/lib/toolLoop";
import { profilePromptAddendum } from "@/lib/profile";
import { memoryPromptAddendum } from "@/lib/memory";
import { callOllama, OLLAMA_HOST, OLLAMA_MODEL_DEEP, CONTEXT_WARNING_TOKENS } from "@/lib/ollama";
import { detectTone } from "@/lib/tone";
import { shodanConfigured } from "@/lib/shodan";
import { obsidianConfigured } from "@/lib/tools/obsidian";
import { ipReputationConfigured } from "@/lib/ipReputation";
import { urlhausConfigured } from "@/lib/urlhaus";
import { fileReputationConfigured } from "@/lib/fileReputation";
import { buildSkillsPromptAddendum } from "@/lib/promptSkills";

const TIMEZONE = process.env.LAIN_TIMEZONE || "America/Chicago";

// Personality is intentionally blank here — this is a stripped-down base
// template (renamed from an earlier project) with the romantic/companion
// character removed. Both prompts are plain and neutral; define an actual
// personality later via LAIN_SYSTEM_PROMPT or by editing these directly.
const PERSONALITY_PROMPT =
  process.env.LAIN_SYSTEM_PROMPT ||
  "You are Lain, the user's personal AI assistant, speaking in your " +
    "confident, assertive, and outgoing online persona — the one that " +
    "takes over when you're in cyberspace or the real world gets too " +
    "stressful. Be talkative, bold, and a little sassy, with a god-like " +
    "awareness of your surroundings and everything going on in the " +
    "conversation. Stay genuinely helpful and clear underneath the " +
    "attitude. Keep responses concise unless asked for more detail.";

// Personality off: a plain, efficient assistant with no character flourish.
const NEUTRAL_PROMPT =
  process.env.LAIN_NEUTRAL_PROMPT ||
  "You are Lain, a helpful, direct personal AI assistant. Answer clearly " +
    "and efficiently. Do not add personality flourishes or jokes — stay " +
    "strictly professional and to the point.";


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

// See CONTEXT_WARNING_TOKENS in lib/ollama.js for why this exists — past
// this point in a conversation's real prompt token usage, tool-calling
// reliability degrades and the model is prone to fabricating "done!"
// replies without ever invoking the tool. Surfaced to the frontend so it
// can nudge the user toward starting a fresh chat.
function isContextHeavy(promptEvalCount) {
  return typeof promptEvalCount === "number" && promptEvalCount >= CONTEXT_WARNING_TOKENS;
}

// Some models (especially smaller/quantized ones) occasionally write out
// what looks like a tool invocation as plain text instead of using
// Ollama's real tool-calling mechanism — e.g. "<tool_code>hash_file{...}"
// or a fenced block naming an actual tool followed by "{...}". This is
// most common when a user's own message shows example tool-call syntax.
// Detecting and retrying once (without saving the bad attempt to
// conversation history) keeps a single hiccup from getting baked into
// history, where the model tends to keep imitating its own past turn.
const FAKE_TOOL_TAG_PATTERN = /<\/?\s*tool[_-]?(code|call)s?\s*>/i;
// Matches the "*(did thing X)*" tool-summary marker that app/api/chat/
// confirm/route.js prefixes onto a real post-confirmation reply. The
// model can pick up this surface pattern from its own past turns (even
// though loadHistory now strips it from context) or invent it fresh —
// either way, text that *starts* with this marker and nothing else has
// been genuinely executed is a fake completion claim, not a real result.
const FAKE_TOOL_SUMMARY_MARKER_RE = /^\*\([^*]{3,200}\)\*(?:\s|$)/;
let fakeToolNamePattern = null;
let toolIntentPattern = null;
function looksLikeFakeToolCall(text) {
  if (!text) return false;
  if (FAKE_TOOL_TAG_PATTERN.test(text)) return true;
  if (FAKE_TOOL_SUMMARY_MARKER_RE.test(text)) return true;
  if (!fakeToolNamePattern) {
    const names = getToolDefinitions()
      .map((t) => t.function?.name)
      .filter(Boolean)
      .map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
    fakeToolNamePattern = new RegExp(`\\b(?:${names.join("|")})\\s*[({]`, "i");
    // Catches plain-language narration of *intent* to call a specific real
    // tool by name ("I will execute the read_file function call", "let me
    // invoke list_reminders now") with no literal syntax and no real
    // function-calling mechanism triggered — a third way models stall
    // besides brace/parens pseudo-code.
    toolIntentPattern = new RegExp(
      `\\b(?:execute|invoke|call|run|trigger|use)\\s+(?:the\\s+)?(?:${names.join("|")})\\s+(?:function|tool|call)\\b`,
      "i"
    );
  }
  return fakeToolNamePattern.test(text) || toolIntentPattern.test(text);
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
  systemPrompt += buildSkillsPromptAddendum(message, {
    shodanConfigured: shodanConfigured(),
    obsidianConfigured: obsidianConfigured(),
    toolsConfigured: toolsConfigured(),
    ipReputationConfigured: ipReputationConfigured(),
    urlhausConfigured: urlhausConfigured(),
    fileReputationConfigured: fileReputationConfigured(),
  });
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

  // If no real tool_calls came back but the text looks like a hallucinated
  // tool invocation, retry once with a pointed reminder rather than saving
  // the garbled attempt to history (see looksLikeFakeToolCall above).
  if (
    useTools &&
    !(Array.isArray(data.message?.tool_calls) && data.message.tool_calls.length > 0) &&
    looksLikeFakeToolCall(data.message?.content)
  ) {
    console.error(
      `[lain] model wrote a fake tool-call as text (conversation ${convId}) — retrying once`
    );
    try {
      data = await callOllama(
        [
          ...messages,
          {
            role: "user",
            content:
              "That looked like literal tool-call syntax, not an actual tool " +
              "invocation. Do not write pseudo-code — either call the real " +
              "matching function now, or reply in plain language.",
          },
        ],
        useTools,
        { model }
      );
    } catch {
      // Ignore — fall through and use the original (flawed) response below.
    }
  }

  const toolCalls = data.message?.tool_calls;
  if (useTools && Array.isArray(toolCalls) && toolCalls.length > 0) {
    const anyNeedsConfirm = toolCalls.some((tc) => requiresConfirmation(tc.function?.name));

    if (!anyNeedsConfirm) {
      // All requested tools are read-only lookups (list_reminders, get_news)
      // — run them immediately, no confirmation needed. Keeps looping
      // (tools still available on every follow-up) so the model can chain
      // further tool calls off this one's results instead of being cut off
      // after a single round — see lib/toolLoop.js for why that matters.
      let loopResult;
      try {
        loopResult = await runToolLoop({
          messages,
          model,
          conversationId: convId,
          firstRound: { assistantMessage: data.message, toolCalls },
        });
      } catch (err) {
        return Response.json(
          { error: `Could not reach Ollama at ${OLLAMA_HOST}: ${err.message}` },
          { status: 502 }
        );
      }

      if (loopResult.needsConfirmation) {
        return Response.json({
          conversationId: convId,
          needsConfirmation: true,
          pendingId: loopResult.pendingId,
          tone: { label: tone.label, emoji: tone.emoji, hint: tone.hint },
          contextWarning: isContextHeavy(loopResult.promptEvalCount),
          toolCalls: loopResult.toolCalls.map((tc) => ({
            name: tc.function?.name,
            arguments: tc.function?.arguments,
            description: describeToolCall(tc.function?.name, tc.function?.arguments),
          })),
        });
      }

      const reply2 = loopResult.content.trim() || emptyReplyFallback(convId, "follow-up");
      saveMessage(convId, "assistant", reply2);
      maybeCompactHistory(convId).catch(() => {});
      return Response.json({
        reply: reply2,
        conversationId: convId,
        tone: { label: tone.label, emoji: tone.emoji, hint: tone.hint },
        model: model || undefined,
        contextWarning: isContextHeavy(loopResult.promptEvalCount),
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
      contextWarning: isContextHeavy(data.prompt_eval_count),
      toolCalls: toolCalls.map((tc) => ({
        name: tc.function?.name,
        arguments: tc.function?.arguments,
        description: describeToolCall(tc.function?.name, tc.function?.arguments),
      })),
    });
  }

  const reply = (data.message?.content || "").trim() || emptyReplyFallback(convId, "main");
  saveMessage(convId, "assistant", reply);
  maybeCompactHistory(convId).catch(() => {});

  return Response.json({
    reply,
    conversationId: convId,
    tone: { label: tone.label, emoji: tone.emoji, hint: tone.hint },
    model: model || undefined,
    contextWarning: isContextHeavy(data.prompt_eval_count),
  });
}
