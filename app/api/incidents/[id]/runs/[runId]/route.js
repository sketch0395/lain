// PATCH { step, status, note? } updates one step; PATCH { finish: "abandoned" | "completed" }
// ends the run.
import { updatePlaybookStep, finishPlaybookRun, getPlaybookRun } from "@/lib/runs";

export async function PATCH(request, { params }) {
  const { runId } = await params;
  const body = await request.json().catch(() => ({}));
  try {
    if (body.finish) {
      if (!finishPlaybookRun(Number(runId), body.finish, "user")) {
        return Response.json({ error: "Run not found or already finished" }, { status: 404 });
      }
      return Response.json({ run: getPlaybookRun(Number(runId)) });
    }
    const run = updatePlaybookStep(Number(runId), body.step, { status: body.status, note: body.note }, "user");
    if (!run) return Response.json({ error: "Not found" }, { status: 404 });
    return Response.json({ run });
  } catch (err) {
    return Response.json({ error: err.message }, { status: 400 });
  }
}
