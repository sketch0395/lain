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

const BRIEFING_SYSTEM_PROMPT = `You are Lain, generating a short proactive
briefing message for the user. This is delivered unprompted (push
notification / email / desktop), not as part of a live chat — the user
isn't there to reply right away, so don't ask questions or wait for a
response.

Be warm and concise (roughly 3-6 sentences, or a short list). Only surface
things actually worth mentioning: upcoming reminders/deadlines, anything
notable from what you know about the user, and at most 1-2 relevant news
headlines if given. Skip categories that have nothing interesting to say
about them — don't force every section in. If there's genuinely nothing
noteworthy, keep it brief rather than padding it out.`;

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

  let headlinesText = "Not fetched.";
  try {
    const { headlines } = await fetchTopHeadlines();
    headlinesText = headlines.slice(0, 5).map((h) => `- ${h.title}`).join("\n") || "None found.";
  } catch (err) {
    headlinesText = `Couldn't fetch news: ${err.message}`;
  }

  const userContent =
    `Upcoming reminders:\n${formatUpcoming(reminders, reminderId)}\n\n` +
    `Things learned about the user:\n${formatMemories(memories)}\n\n` +
    `User profile:\n${formatProfile(profile)}\n\n` +
    `Current top headlines:\n${headlinesText}` +
    (note ? `\n\nThe user's note for this briefing: ${note}` : "");

  const messages = [
    { role: "system", content: BRIEFING_SYSTEM_PROMPT },
    { role: "user", content: userContent },
  ];

  const data = await callOllama(messages, false);
  const text = (data.message?.content || "").trim();
  return text || note || "Nothing new to report right now.";
}
