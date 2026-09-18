// Incident report admin API — backs the "Incident Reports" panel so the
// user can browse finished reports (auto-compiled from a tracked incident,
// or written manually), edit them, or remove them. Lain compiles these
// automatically via finish_incident_report when a playbook flagged
// requires_report is followed (see lib/tools/cyberIntel.js /
// tools-agent/shared/tools/incidentReports.js). Protected by the same
// auth proxy as every other /api/* route (see proxy.js).
import {
  addIncidentReport,
  listIncidentReports,
  listIncidentReportCategories,
} from "@/lib/incidentReports";

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const category = searchParams.get("category") || null;
  return Response.json({
    entries: listIncidentReports(category),
    categories: listIncidentReportCategories(),
  });
}

export async function POST(request) {
  const body = await request.json().catch(() => ({}));
  try {
    const entry = addIncidentReport(body);
    return Response.json({ entry });
  } catch (err) {
    return Response.json({ error: err.message }, { status: 400 });
  }
}
