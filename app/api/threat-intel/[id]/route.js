import { deleteThreatIntel } from "@/lib/threatIntel";

export async function DELETE(request, { params }) {
  const { id } = await params;
  const removed = deleteThreatIntel(Number(id));
  return Response.json({ removed });
}
