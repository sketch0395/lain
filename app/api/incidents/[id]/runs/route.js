// Starts a playbook run on an incident: POST { playbookId }.
import { startPlaybookRun } from "@/lib/runs";

export async function POST(request, { params }) {
  const { id } = await params;
  const body = await request.json().catch(() => ({}));
  try {
    const run = startPlaybookRun(Number(id), Number(body.playbookId), "user");
    if (!run) return Response.json({ error: "Incident or playbook not found" }, { status: 404 });
    return Response.json({ run });
  } catch (err) {
    return Response.json({ error: err.message }, { status: 400 });
  }
}
