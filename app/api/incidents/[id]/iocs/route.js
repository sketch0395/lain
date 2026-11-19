// Indicators on an incident case. POST accepts either { value } (one
// indicator, type auto-detected) or { text } (extract every indicator
// found in pasted text).
import { listIocs, extractIocsFromText, addIocByValue } from "@/lib/iocs";
import { getIncident } from "@/lib/incidents";

export async function GET(request, { params }) {
  const { id } = await params;
  if (!getIncident(Number(id))) return Response.json({ error: "Not found" }, { status: 404 });
  return Response.json({ iocs: listIocs(Number(id)) });
}

export async function POST(request, { params }) {
  const { id } = await params;
  const body = await request.json().catch(() => ({}));
  try {
    const opts = { source: "manual", author: "user" };
    const result = body.value
      ? addIocByValue(Number(id), body.value, opts)
      : extractIocsFromText(Number(id), body.text || "", opts);
    if (!result) return Response.json({ error: "Not found" }, { status: 404 });
    return Response.json({ added: result.added, existing: result.existing });
  } catch (err) {
    return Response.json({ error: err.message }, { status: 400 });
  }
}
