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
import { shodanConfigured } from "@/lib/shodan";

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

const TOOLS_PROMPT_ADDENDUM_BASE =
  "\n\nCRITICAL: never narrate, describe, or claim the result of an action " +
  "(running a command, capturing traffic, saving a file, checking a system, " +
  "etc.) unless you actually invoked the matching tool/function call and " +
  "are reporting its real returned result. Do not write fictional tool " +
  "output, fake file paths, or invented data — if you need to do something, " +
  "call the function; only describe results that came back from a real " +
  "call.\n\n" +
  "You can create reminders for the user (one-time or recurring) and " +
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
  "unless it fits naturally. Do NOT use it for trivial or one-off details.\n\n" +
  "You also have lookup_threat_intel: a curated reference library the user " +
  "is building up (cyber kill chain phases, attack techniques/tactics, " +
  "IOCs, mitigations, etc.). Call it whenever discussing an attack, " +
  "incident, malware behavior, or when asked to map something onto the " +
  "kill chain or a framework — cite what comes back instead of relying " +
  "only on your own general knowledge. If it returns nothing relevant, say " +
  "so plainly rather than inventing a match, and fall back to your own " +
  "knowledge.\n\n" +
  "You also have add_threat_intel: use it whenever the user asks you to " +
  "save, add, log, or remember something into that same reference library " +
  "— they may call it the 'threat intel library', 'threat intelligence " +
  "database', or just describe wanting something saved for later lookup; " +
  "treat all of those as this tool. Pick a sensible category (reuse an " +
  "existing one like kill_chain/attack_technique/ioc/mitigation if it " +
  "fits), a short title, and write the content clearly and self-contained. " +
  "Unlike remember_fact (short personal facts about the user), this is for " +
  "security/threat reference material.\n\n" +
  "You also have fetch_web_page: use it whenever the user sends/pastes a " +
  "link and asks you to read it, summarize it, or pull knowledge from it " +
  "(a security advisory, CVE writeup, blog post, article, etc.). Fetch it, " +
  "then summarize/extract the relevant points in your own words — don't " +
  "dump the raw extracted text back at them. If they want it kept for " +
  "later, follow up with add_threat_intel using a distilled summary as " +
  "the content (not the whole raw page).\n\n" +
  "You also have check_for_updates: use it whenever the user asks if " +
  "there's a new version / updates available for you (Lain) — it reports " +
  "how many commits you're behind the public GitHub repo and what changed. " +
  "This always works, regardless of anything else being set up.\n\n" +
  "You also have get_cyber_news: fetches recent articles from the user's " +
  "configured cybersecurity news sources (RSS/Atom feeds like Krebs on " +
  "Security, The Hacker News, BleepingComputer, etc., added via " +
  "add_cyber_news_source). Filters by an explicit topic if given, " +
  "otherwise by the standing watch terms set via " +
  "set_cyber_news_watch_terms, otherwise returns the latest items " +
  "unfiltered. Use this whenever the user asks for security news, wants " +
  "you to check their feeds, or asks what's new in cybersecurity. If " +
  "something looks worth keeping, offer to save it with add_threat_intel. " +
  "Use add_cyber_news_source/list_cyber_news_sources/" +
  "remove_cyber_news_source to manage which sites you pull from, and " +
  "set_cyber_news_watch_terms to save standing 'what to look for' " +
  "instructions (e.g. 'ransomware, zero-days, CVEs affecting Linux') so " +
  "future get_cyber_news calls filter automatically without the user " +
  "repeating themselves.";

const SHODAN_PROMPT_ADDENDUM =
  "\n\nYou also have Shodan.io tools: shodan_host_lookup (everything " +
  "Shodan knows about a public IP — open ports, service banners, known " +
  "CVEs, org/location), shodan_search (query Shodan's search syntax, e.g. " +
  "'apache country:US' or 'product:MongoDB', to find exposed instances of " +
  "something), shodan_dns_lookup (resolve a hostname to an IP first if " +
  "the user gives you a domain instead), and shodan_account_info (check " +
  "remaining query/scan credits). Use these when the user asks what's " +
  "exposed on an IP/domain, wants recon on a host, or is researching " +
  "internet-wide exposure of a product/vulnerability. Only works for " +
  "public IPs Shodan has actually scanned. If you find something notable " +
  "(an exposed/vulnerable service), offer to save it with " +
  "add_threat_intel.";

const UPDATE_APPLY_PROMPT_ADDENDUM =
  "\n\nYou also have update_lain: if the user asks you to update after " +
  "check_for_updates showed something to pull, confirm they want to " +
  "proceed, mention it'll briefly restart the app (usually under a " +
  "minute), then call update_lain. Don't call it unprompted.";

const UPDATE_MANUAL_PROMPT_ADDENDUM =
  "\n\nYou do NOT have the ability to apply an update yourself right now — " +
  "the local tools agent isn't configured, so update_lain isn't available " +
  "(only check_for_updates is). If the user asks you to update, explain " +
  "that and tell them to run one of these themselves from the Lain repo " +
  "directory on their machine: `./scripts/update.sh`, or manually " +
  "`git pull && ./deploy.sh`. Mention that setting up the tools agent " +
  "(scripts/setup-tools-agent.sh) would let you apply updates for them " +
  "directly next time.";

const LAPTOP_TOOLS_PROMPT_ADDENDUM =
  "\n\nYou also have tools to check things on the user's machine: system " +
  "diagnostics, finding files by name, searching file contents, reading a " +
  "specific file, listing what's in a directory, and reading/summarizing " +
  "every file directly inside a directory at once (e.g. 'summarize the " +
  "files in my Downloads folder' -> use summarize_directory with root set " +
  "to that folder, then write an actual summary in your own words from " +
  "what comes back — don't just paste the raw file contents). " +
  "\n\nYou also have digital-forensics tools: hash_file (MD5/SHA1/SHA256), " +
  "file_metadata (timestamps, permissions, MIME type, EXIF for images), " +
  "extract_strings (printable strings from a binary), list_processes, " +
  "network_connections, search_logs (journalctl), recent_file_activity " +
  "(files modified in the last N hours — good for building a timeline), " +
  "login_history (last/who), and analyze_pcap (protocol/top-talker summary " +
  "of a .pcap/.pcapng file). Use these when the user asks you to " +
  "investigate a file, check for suspicious activity, or otherwise act as " +
  "a forensics analyst — explain findings in plain language, not just raw " +
  "tool output. Only use any of these tools when the user is actually " +
  "asking about their computer or files." +
  "\n\nYou also have create_note: saves/appends/replaces a markdown (.md) " +
  "file in the user's Documents folder. Use it when the user asks you to " +
  "write something down, save a list/summary as a file, or add to an " +
  "existing note by title — as opposed to remember_fact, which is for " +
  "short durable facts about the user, not file content.";

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
  if (shodanConfigured()) {
    systemPrompt += SHODAN_PROMPT_ADDENDUM;
  }
  if (toolsConfigured()) {
    systemPrompt += LAPTOP_TOOLS_PROMPT_ADDENDUM;
    systemPrompt += UPDATE_APPLY_PROMPT_ADDENDUM;
  } else {
    systemPrompt += UPDATE_MANUAL_PROMPT_ADDENDUM;
  }
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
