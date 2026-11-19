// PATCH { action: "dismiss" | "promote", incidentId? } — promote attaches the
// alert to incidentId, or opens a new case from it when omitted.
import { dismissAlert, promoteAlert } from "@/lib/alerts";

export async function PATCH(request, { params }) {
  const { id } = await params;
  const body = await request.json().catch(() => ({}));
  try {
    if (body.action === "dismiss") {
      const alert = dismissAlert(Number(id));
      return alert ? Response.json({ alert }) : Response.json({ error: "Not found" }, { status: 404 });
    }
    if (body.action === "promote") {
      const result = promoteAlert(Number(id), { incidentId: body.incidentId ? Number(body.incidentId) : undefined });
      return result ? Response.json(result) : Response.json({ error: "Not found" }, { status: 404 });
    }
    return Response.json({ error: "action must be dismiss or promote" }, { status: 400 });
  } catch (err) {
    return Response.json({ error: err.message }, { status: 400 });
  }
}
