// Adapter over lib/alertIngest.js (Lain-only): injects Lain's SQLite
// connection and adds the side effects triage shouldn't hold itself —
// a notification when a case is opened automatically, and best-effort IOC
// enrichment of cases that alerts opened or fed.
import { getDb } from "@/lib/db";
import alertIngest from "./alertIngest";
import { enrichIncidentIocs } from "./iocs";
import { sendReminderNotification } from "./notify";

const AUTO_OPEN_SEVERITIES = ["low", "medium", "high", "critical"];

function autoOpenSeverity() {
  const v = String(process.env.LAIN_ALERT_AUTO_OPEN_SEVERITY || "").toLowerCase();
  return AUTO_OPEN_SEVERITIES.includes(v) ? v : "high";
}

export function alertWebhookConfigured() {
  return !!process.env.LAIN_ALERT_WEBHOOK_TOKEN;
}

export async function ingestAlerts(payload, source) {
  const results = alertIngest.ingest(getDb(), payload, { source, autoOpenSeverity: autoOpenSeverity() });
  for (const r of results) {
    if (r.deduped || !r.incident_id) continue;
    enrichIncidentIocs(r.incident_id, { limit: 5 }).catch((err) =>
      console.error("[lain] alert IOC enrichment failed:", err)
    );
    if (r.action === "opened") {
      sendReminderNotification(
        `🚨 New ${r.alert.severity} incident #${r.incident_id}`,
        `${r.alert.source}: ${r.alert.title}`
      ).catch((err) => console.error("[lain] alert notification failed:", err));
    }
  }
  return results;
}

export function listAlerts(opts) {
  return alertIngest.listAlerts(getDb(), opts);
}

export function dismissAlert(id) {
  return alertIngest.dismissAlert(getDb(), id);
}

export function promoteAlert(id, opts) {
  return alertIngest.promoteAlert(getDb(), id, opts);
}

// Called from the scheduler: drains pending IOC enrichment (a few per call,
// to respect free-tier rate limits) for open cases that alerts created or
// fed, e.g. ones where the first batch hit its limit.
export async function enrichAlertIncidents() {
  const rows = getDb()
    .prepare(
      `SELECT DISTINCT i.id FROM incidents i
       JOIN alerts a ON a.incident_id = i.id
       JOIN incident_iocs c ON c.incident_id = i.id
       WHERE i.status NOT IN ('resolved', 'closed') AND c.enriched_at IS NULL
       LIMIT 3`
    )
    .all();
  for (const { id } of rows) await enrichIncidentIocs(id, { limit: 3 });
}
