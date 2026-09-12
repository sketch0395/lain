// Browser push notification delivery via the Web Push protocol, so
// reminders can reach the user even without the laptop tools-agent (e.g. on
// a phone, or when the laptop is asleep). Requires VAPID_PUBLIC_KEY /
// VAPID_PRIVATE_KEY to be configured — generate a pair with:
//   node -e "console.log(require('web-push').generateVAPIDKeys())"

import webpush from "web-push";
import { getDb } from "./db";

const PUBLIC_KEY = process.env.VAPID_PUBLIC_KEY || "";
const PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY || "";
const SUBJECT = process.env.VAPID_SUBJECT || "mailto:admin@example.com";

let configured = false;
function ensureConfigured() {
  if (configured) return true;
  if (!PUBLIC_KEY || !PRIVATE_KEY) return false;
  webpush.setVapidDetails(SUBJECT, PUBLIC_KEY, PRIVATE_KEY);
  configured = true;
  return true;
}

export function pushConfigured() {
  return Boolean(PUBLIC_KEY && PRIVATE_KEY);
}

export function getVapidPublicKey() {
  return PUBLIC_KEY;
}

export function saveSubscription(sub) {
  if (!sub?.endpoint || !sub?.keys?.p256dh || !sub?.keys?.auth) {
    throw new Error("Invalid push subscription");
  }
  const db = getDb();
  db.prepare(
    `INSERT OR REPLACE INTO push_subscriptions (endpoint, p256dh, auth, created_at)
     VALUES (?, ?, ?, ?)`
  ).run(sub.endpoint, sub.keys.p256dh, sub.keys.auth, Date.now());
}

export function removeSubscription(endpoint) {
  const db = getDb();
  db.prepare(`DELETE FROM push_subscriptions WHERE endpoint = ?`).run(endpoint);
}

export function subscriptionCount() {
  const db = getDb();
  return db.prepare(`SELECT COUNT(*) AS n FROM push_subscriptions`).get().n;
}

export async function sendPushToAll(payload) {
  if (!ensureConfigured()) return;
  const db = getDb();
  const subs = db.prepare(`SELECT endpoint, p256dh, auth FROM push_subscriptions`).all();
  const body = JSON.stringify(payload);

  await Promise.all(
    subs.map(async (s) => {
      const subscription = { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } };
      try {
        await webpush.sendNotification(subscription, body);
      } catch (err) {
        // 404/410 means the subscription is dead (browser data cleared, etc.)
        if (err.statusCode === 404 || err.statusCode === 410) {
          removeSubscription(s.endpoint);
        }
        console.error(
          `[lain] push send failed (endpoint ...${s.endpoint.slice(-12)}): ` +
            `status=${err.statusCode} ${err.body || err.message}`
        );
      }
    })
  );
}
