import { updateIncidentReport, deleteIncidentReport } from "@/lib/incidentReports";

export async function PATCH(request, { params }) {
  const { id } = await params;
  const body = await request.json().catch(() => ({}));
  try {
    const entry = updateIncidentReport(Number(id), body);
    if (!entry) return Response.json({ error: "Not found" }, { status: 404 });
    return Response.json({ entry });
  } catch (err) {
    return Response.json({ error: err.message }, { status: 400 });
  }
}

export async function DELETE(request, { params }) {
  const { id } = await params;
  const removed = deleteIncidentReport(Number(id));
  return Response.json({ removed });
}
