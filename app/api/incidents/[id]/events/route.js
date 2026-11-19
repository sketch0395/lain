import { addIncidentEvent } from "@/lib/incidents";
import { extractIocsFromText } from "@/lib/iocs";

export async function POST(request, { params }) {
  const { id } = await params;
  const body = await request.json().catch(() => ({}));
  try {
    const event = addIncidentEvent(Number(id), { ...body, author: body.author || "user" });
    if (!event) return Response.json({ error: "Not found" }, { status: 404 });
    // Indicators mentioned in a note are recorded on the case automatically.
    const iocs = extractIocsFromText(Number(id), event.content, { source: "note", author: "user" });
    return Response.json({ event, iocsAdded: iocs?.added.length || 0 });
  } catch (err) {
    return Response.json({ error: err.message }, { status: 400 });
  }
}
