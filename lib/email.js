// Email delivery for reminders via SMTP (nodemailer). Optional — leave
// SMTP_HOST/SMTP_USER/SMTP_PASS unset to disable entirely. Each reminder can
// specify its own recipient(s) (comma-separated); LAIN_REMINDER_EMAIL_TO is
// just the fallback default used when a reminder doesn't set one.
//
// Works well alongside or instead of desktop/push notifications: unlike
// those, email doesn't need the laptop tools agent, a browser subscription,
// or the app to be open — just a mailbox.

import nodemailer from "nodemailer";

const SMTP_HOST = process.env.SMTP_HOST || "";
const SMTP_PORT = Number(process.env.SMTP_PORT) || 587;
const SMTP_SECURE = process.env.SMTP_SECURE === "true" || SMTP_PORT === 465;
const SMTP_USER = process.env.SMTP_USER || "";
const SMTP_PASS = process.env.SMTP_PASS || "";
const SMTP_FROM = process.env.SMTP_FROM || SMTP_USER;
const DEFAULT_TO = process.env.LAIN_REMINDER_EMAIL_TO || "";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

let transporter;
function getTransporter() {
  if (transporter) return transporter;
  transporter = nodemailer.createTransport({
    host: SMTP_HOST,
    port: SMTP_PORT,
    secure: SMTP_SECURE,
    auth: SMTP_USER ? { user: SMTP_USER, pass: SMTP_PASS } : undefined,
  });
  return transporter;
}

/** True once SMTP itself is set up (independent of any specific recipient). */
export function emailConfigured() {
  return Boolean(SMTP_HOST && SMTP_FROM);
}

/** The server-configured fallback recipient, or "" if none is set. */
export function defaultEmailTo() {
  return DEFAULT_TO;
}

/** Parses/validates a comma-separated recipient list; throws on any bad address. */
export function parseEmailList(str) {
  if (!str) return [];
  const addrs = String(str)
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  for (const addr of addrs) {
    if (!EMAIL_RE.test(addr)) throw new Error(`Invalid email address: "${addr}"`);
  }
  return addrs;
}

export async function sendReminderEmail(title, body, to) {
  const recipients = to && to.length ? to : parseEmailList(DEFAULT_TO);
  if (!emailConfigured() || recipients.length === 0) return false;
  await getTransporter().sendMail({
    from: SMTP_FROM,
    to: recipients.join(", "),
    subject: `🔔 Lain: ${title}`,
    text: body,
  });
  return true;
}
