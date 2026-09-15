// Polls for due reminders and fires them. Started once per server process
// via instrumentation.js's register() hook — this app runs as a single
// long-lived Node process (`next start` in standalone mode), so a plain
// setInterval is enough; no external cron/queue infrastructure needed.

import { getDueReminders, advanceReminder } from "./reminders";
import { sendReminderNotification } from "./notify";
import { fetchTopHeadlines } from "./news";
import { fetchCyberNews, listCyberNewsSources } from "./cyberNews";
import { buildProactiveBriefing } from "./briefing";
import { saveMessage } from "./conversations";

const TICK_MS = 30 * 1000;
let started = false;

export function startScheduler() {
  if (started) return;
  started = true;
  console.log("[lain] reminder scheduler started");
  runTick();
  setInterval(runTick, TICK_MS);
}

function runTick() {
  tick().catch((err) => console.error("[lain] scheduler tick failed:", err));
}

async function tick() {
  const due = getDueReminders();
  for (const reminder of due) {
    try {
      await fireReminder(reminder);
    } catch (err) {
      console.error(`[lain] failed to fire reminder ${reminder.id}:`, err);
    }
    advanceReminder(reminder);
  }
}

async function fireReminder(reminder) {
  let body = reminder.message;

  if (reminder.action === "news") {
    try {
      // Prefer the user's configured cybersecurity sources over generic
      // top headlines when any are set up — otherwise a "news" reminder
      // titled/intended for security topics silently gets unrelated
      // general headlines instead (or none, if it happens to filter to
      // nothing relevant).
      const cyberSources = listCyberNewsSources();
      let list;
      if (cyberSources.length > 0) {
        const { items } = await fetchCyberNews({});
        list = items.map((h) => `• [${h.source}] ${h.title} — ${h.link}`).join("\n");
      } else {
        const { headlines } = await fetchTopHeadlines();
        list = headlines.map((h) => `• ${h.title}${h.link ? ` — ${h.link}` : ""}`).join("\n");
      }
      body = list ? `${reminder.message}\n\n${list}` : reminder.message;
    } catch (err) {
      body = `${reminder.message}\n\n(Couldn't fetch news right now: ${err.message})`;
    }
  } else if (reminder.action === "digest") {
    try {
      body = await buildProactiveBriefing(reminder.message, reminder.id);
    } catch (err) {
      body = `(Couldn't generate today's briefing: ${err.message})`;
    }
  }

  await sendReminderNotification(reminder.title, body, { emailTo: reminder.email_to });

  if (reminder.conversation_id) {
    saveMessage(
      reminder.conversation_id,
      "assistant",
      `🔔 *(reminder: ${reminder.title})*\n\n${body}`
    );
  }
}
