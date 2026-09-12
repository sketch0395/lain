// Delivers a fired reminder to the user over every channel that's
// configured: a desktop notification on the laptop (via the tools agent),
// a browser push notification, and/or email. Any combination (or none) can
// be configured — the scheduler doesn't care, it just calls this.

import { notifyLaptop } from "./tools";
import { sendPushToAll, pushConfigured } from "./push";
import { sendReminderEmail, emailConfigured, parseEmailList } from "./email";

export async function sendReminderNotification(title, body, { emailTo } = {}) {
  const results = { desktop: false, push: false, email: false };

  results.desktop = await notifyLaptop(title, body);

  if (pushConfigured()) {
    try {
      await sendPushToAll({ title, body });
      results.push = true;
    } catch (err) {
      console.error("[lain] sendPushToAll threw:", err);
    }
  }

  if (emailConfigured()) {
    try {
      results.email = await sendReminderEmail(title, body, parseEmailList(emailTo));
    } catch (err) {
      console.error("[lain] sendReminderEmail failed:", err);
    }
  }

  console.log(
    `[lain] reminder notification "${title}": desktop=${results.desktop} push=${results.push} email=${results.email}`
  );
  return results;
}
