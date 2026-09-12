import { deleteMemory } from "@/lib/memory";

export async function DELETE(request, { params }) {
  const { id } = await params;
  const removed = deleteMemory(Number(id));
  return Response.json({ removed });
}
