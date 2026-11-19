import { addIncidentEvent } from "@/lib/incidents";

export async function POST(request, { params }) {
  const { id } = await params;
  const body = await request.json().catch(() => ({}));
  try {
    const event = addIncidentEvent(Number(id), { ...body, author: body.author || "user" });
    if (!event) return Response.json({ error: "Not found" }, { status: 404 });
    return Response.json({ event });
  } catch (err) {
    return Response.json({ error: err.message }, { status: 400 });
  }
}
