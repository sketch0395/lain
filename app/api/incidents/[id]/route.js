import { getIncident, updateIncident, deleteIncident } from "@/lib/incidents";

export async function GET(request, { params }) {
  const { id } = await params;
  const incident = getIncident(Number(id));
  if (!incident) return Response.json({ error: "Not found" }, { status: 404 });
  return Response.json({ incident });
}

export async function PATCH(request, { params }) {
  const { id } = await params;
  const body = await request.json().catch(() => ({}));
  try {
    const incident = updateIncident(Number(id), body, "user");
    if (!incident) return Response.json({ error: "Not found" }, { status: 404 });
    return Response.json({ incident });
  } catch (err) {
    return Response.json({ error: err.message }, { status: 400 });
  }
}

export async function DELETE(request, { params }) {
  const { id } = await params;
  return Response.json({ removed: deleteIncident(Number(id)) });
}
