// Polls for due reminders and fires them. Started once per server process
// via instrumentation.js's register() hook — this app runs as a single
// long-lived Node process (`next start` in standalone mode), so a plain
// setInterval is enough; no external cron/queue infrastructure needed.

import { getDueReminders, advanceReminder, setReminderConversationId } from "./reminders";
import { sendReminderNotification } from "./notify";
import { fetchTopHeadlines } from "./news";
import { fetchCyberNews, listCyberNewsSources } from "./cyberNews";
import { buildProactiveBriefing } from "./briefing";
import { saveMessage, ensureConversation } from "./conversations";

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
        const { items, errors } = await fetchCyberNews({});
        list = items.length
          ? items.map((h) => `• [${h.source}] ${h.title} — ${h.link}`).join("\n")
          : `(No matching cyber news items right now${errors.length ? ` — ${errors.join("; ")}` : ""}.)`;
      } else {
        const { headlines } = await fetchTopHeadlines();
        list = headlines.length
          ? headlines.map((h) => `• ${h.title}${h.link ? ` — ${h.link}` : ""}`).join("\n")
          : "(No headlines came back right now.)";
      }
      body = `${reminder.message}\n\n${list}`;
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

  // Always land the fired reminder's full output (news list / briefing) in
  // a real conversation the user can open — a desktop/push notification
  // truncates long bodies to a one-line preview, which is why a "news"
  // reminder can look like it "did nothing" even though it worked. This
  // also self-heals a conversation_id that's missing or points at a
  // conversation the user has since deleted (previously a plain
  // saveMessage would throw a FOREIGN KEY error there and silently drop
  // the reminder's output for good).
  const convId = ensureConversation(reminder.conversation_id);
  if (convId !== reminder.conversation_id) {
    setReminderConversationId(reminder.id, convId);
  }
  saveMessage(convId, "assistant", `🔔 *(reminder: ${reminder.title})*\n\n${body}`);
}
