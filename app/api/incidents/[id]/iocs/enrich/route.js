// Enriches an incident's pending indicators (or one, with { iocId }) via
// the configured reputation services. Sequential and capped per call to
// respect free-tier rate limits — the response's `remaining` says if more
// are left.
import { enrichIncidentIocs } from "@/lib/iocs";

export async function POST(request, { params }) {
  const { id } = await params;
  const body = await request.json().catch(() => ({}));
  try {
    const r = await enrichIncidentIocs(Number(id), { limit: body.limit, iocId: body.iocId });
    if (!r) return Response.json({ error: "Not found" }, { status: 404 });
    if (r.error) return Response.json({ error: r.error }, { status: 404 });
    return Response.json(r);
  } catch (err) {
    return Response.json({ error: err.message }, { status: 400 });
  }
}
