// Inbound alert webhook (Wazuh, Suricata EVE, or any JSON). This path is
// excluded from the session-auth proxy (see proxy.js) because senders are
// machines, so it authenticates itself: a dedicated shared secret in
// LAIN_ALERT_WEBHOOK_TOKEN, sent as `Authorization: Bearer <token>` or
// `X-Lain-Token`. Disabled (503) until the token is set. Optional
// `?source=wazuh` labels alerts that don't identify themselves.
import { timingSafeEqual } from "node:crypto";
import { alertWebhookConfigured, ingestAlerts } from "@/lib/alerts";

const MAX_BODY_BYTES = 256 * 1024;

function authorized(request) {
  const expected = process.env.LAIN_ALERT_WEBHOOK_TOKEN || "";
  const header = request.headers.get("authorization") || "";
  const bearer = header.startsWith("Bearer ") ? header.slice(7) : "";
  const token = bearer || request.headers.get("x-lain-token") || "";
  const a = Buffer.from(token);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function POST(request) {
  if (!alertWebhookConfigured()) {
    return Response.json({ error: "Alert webhook is not enabled" }, { status: 503 });
  }
  if (!authorized(request)) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  const text = await request.text();
  if (text.length > MAX_BODY_BYTES) {
    return Response.json({ error: "Payload too large" }, { status: 413 });
  }
  let payload;
  try {
    payload = JSON.parse(text);
  } catch {
    payload = text.trim();
  }
  if (!payload) return Response.json({ error: "Empty payload" }, { status: 400 });
  const source = new URL(request.url).searchParams.get("source") || undefined;
  try {
    const results = await ingestAlerts(payload, source);
    return Response.json({
      received: results.length,
      results: results.map((r) => ({
        alert_id: r.alert.id,
        deduped: r.deduped,
        action: r.action,
        incident_id: r.incident_id,
      })),
    });
  } catch (err) {
    console.error("[lain] alert ingest failed:", err);
    return Response.json({ error: "Ingest failed" }, { status: 500 });
  }
}
