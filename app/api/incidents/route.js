// Incident case API — backs the /incidents board. Cases are also opened
// and updated by Lain via the open_incident/update_incident tools (see
// lib/tools/cyberIntel.js). Protected by the same auth proxy as every
// other /api/* route (see proxy.js).
import { createIncident, listIncidents } from "@/lib/incidents";

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const status = searchParams.get("status") || undefined;
  try {
    return Response.json({ incidents: listIncidents({ status }) });
  } catch (err) {
    return Response.json({ error: err.message }, { status: 400 });
  }
}

export async function POST(request) {
  const body = await request.json().catch(() => ({}));
  try {
    return Response.json({ incident: createIncident(body) });
  } catch (err) {
    return Response.json({ error: err.message }, { status: 400 });
  }
}
