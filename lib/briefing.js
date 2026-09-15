// Generates a short, personalized "proactive briefing" for digest-style
// reminders — pulls together upcoming reminders, recently-learned memories,
// the user's profile, and current headlines, then asks the LLM to turn that
// into a warm, concise, unprompted message (delivered like any other
// reminder, via lib/notify.js). This is what makes a "digest" reminder feel
// proactive rather than just a static repeated message.

import { callOllama } from "./ollama";
import { listReminders } from "./reminders";
import { listMemories } from "./memory";
import { getProfile } from "./profile";
import { fetchTopHeadlines } from "./news";
import { fetchCyberNews, listCyberNewsSources, getCyberNewsWatchTerms } from "./cyberNews";

const BRIEFING_SYSTEM_PROMPT = `You are Lain, generating a short proactive
briefing message for the user. This is delivered unprompted (push
notification / email / desktop), not as part of a live chat — the user
isn't there to reply right away, so don't ask questions or wait for a
response.

Be warm and concise (roughly 3-6 sentences, or a short list). Only surface
things actually worth mentioning: upcoming reminders/deadlines, anything
notable from what you know about the user, and at most 2-3 relevant news
items if given (if the news section is cybersecurity articles from the
user's configured sources, actually mention specific ones by name/topic —
that's the point of a "cyber digest", don't just say "check the news").
Skip categories that have nothing interesting to say about them — don't
force every section in. If there's genuinely nothing
noteworthy, keep it brief rather than padding it out.

For any news item you mention, always cite it: include the source name and
its direct article URL (given alongside each item below) right after
mentioning it, e.g. "- Some headline — Source Name: https://...". Never
paraphrase a news item without also including its link — the user may
forward this digest to other people, so an unsourced claim isn't useful to
them. If you genuinely mention no news items, you don't need a links
section.`;

function formatUpcoming(reminders, excludeId) {
  const soon = reminders
    .filter((r) => r.id !== excludeId)
    .filter((r) => new Date(r.next_run).getTime() - Date.now() < 2 * 24 * 60 * 60 * 1000)
    .slice(0, 10);
  if (soon.length === 0) return "None in the next 48 hours.";
  return soon.map((r) => `- ${r.title} (${r.next_run})`).join("\n");
}

function formatMemories(memories) {
  if (memories.length === 0) return "Nothing recorded yet.";
  return memories.slice(0, 15).map((m) => `- ${m.content}`).join("\n");
}

function formatProfile(profile) {
  const lines = Object.entries(profile)
    .filter(([, v]) => v)
    .map(([k, v]) => `${k}: ${v}`);
  return lines.length ? lines.join("\n") : "No profile info set.";
}

/**
 * Builds the briefing text for a digest reminder. `note` is the reminder's
 * own `message` field, treated as an optional focus/instruction from the
 * user (e.g. "focus on work stuff"). `reminderId` is excluded from the
 * "upcoming" list so a recurring digest doesn't reference itself.
 */
export async function buildProactiveBriefing(note, reminderId) {
  const reminders = listReminders();
  const memories = listMemories();
  const profile = getProfile();

  // If the user has configured cybersecurity news sources (via
  // add_cyber_news_source), prefer those for the "news" section of the
  // briefing over generic top headlines — a "cyber"/"security" digest is
  // otherwise silently empty, since general headlines almost never happen
  // to match security topics and the LLM is instructed to skip sections
  // with nothing relevant to say.
  let headlinesText = "Not fetched.";
  let citedItems = [];
  const cyberSources = listCyberNewsSources();
  if (cyberSources.length > 0) {
    try {
      // Deliberately don't pass `note` as the topic filter here — it's a
      // free-form sentence (e.g. "Here is your daily cyber digest"), not a
      // keyword list, and would almost never substring-match any article,
      // silently producing an empty digest again. fetchCyberNews already
      // falls back to the user's explicit set_cyber_news_watch_terms filter
      // (or unfiltered latest items) when no topic is passed.
      const { items } = await fetchCyberNews({});
      citedItems = items.slice(0, 8);
      headlinesText = citedItems.length
        ? citedItems.map((h) => `- [${h.source}] ${h.title} (${h.link})`).join("\n")
        : `None matching (watching for: ${getCyberNewsWatchTerms() || "anything"}).`;
    } catch (err) {
      headlinesText = `Couldn't fetch cyber news: ${err.message}`;
    }
  } else {
    try {
      const { headlines } = await fetchTopHeadlines();
      citedItems = headlines.slice(0, 5);
      headlinesText = citedItems.map((h) => `- ${h.title}${h.link ? ` (${h.link})` : ""}`).join("\n") || "None found.";
    } catch (err) {
      headlinesText = `Couldn't fetch news: ${err.message}`;
    }
  }

  const userContent =
    `Upcoming reminders:\n${formatUpcoming(reminders, reminderId)}\n\n` +
    `Things learned about the user:\n${formatMemories(memories)}\n\n` +
    `User profile:\n${formatProfile(profile)}\n\n` +
    `${cyberSources.length > 0 ? "Recent cybersecurity news (from your configured sources)" : "Current top headlines"}:\n${headlinesText}` +
    (note ? `\n\nThe user's note for this briefing: ${note}` : "");

  const messages = [
    { role: "system", content: BRIEFING_SYSTEM_PROMPT },
    { role: "user", content: userContent },
  ];

  const data = await callOllama(messages, false);
  const text = (data.message?.content || "").trim();
  const body = text || note || "Nothing new to report right now.";

  // Don't rely solely on the LLM to preserve links in prose — it can
  // paraphrase or drop them. Append a deterministic "Sources" list of the
  // news items that were actually offered to it, so the digest is always
  // shareable/verifiable even if the generated text omits a URL.
  const linkedItems = citedItems.filter((h) => h.link);
  if (linkedItems.length > 0) {
    const sources = linkedItems
      .map((h) => `- ${h.title} — ${h.source ? `${h.source}: ` : ""}${h.link}`)
      .join("\n");
    return `${body}\n\nSources:\n${sources}`;
  }
  return body;
}
