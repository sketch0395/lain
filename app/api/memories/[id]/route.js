import { deleteMemory, updateMemory } from "@/lib/memory";

export async function PATCH(request, { params }) {
  const { id } = await params;
  const body = await request.json().catch(() => ({}));
  try {
    const memory = updateMemory(Number(id), body.content);
    if (!memory) return Response.json({ error: "Not found" }, { status: 404 });
    return Response.json({ memory });
  } catch (err) {
    return Response.json({ error: err.message }, { status: 400 });
  }
}

export async function DELETE(request, { params }) {
  const { id } = await params;
  const removed = deleteMemory(Number(id));
  return Response.json({ removed });
}
