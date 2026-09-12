import {
  deleteConversation,
  loadHistory,
  renameConversation,
} from "@/lib/conversations";

export async function GET(request, { params }) {
  const { id } = await params;
  return Response.json(loadHistory(id, 1000));
}

export async function PATCH(request, { params }) {
  const { id } = await params;
  const { title } = await request.json();
  if (typeof title !== "string" || !title.trim()) {
    return Response.json({ error: "title is required" }, { status: 400 });
  }
  const ok = renameConversation(id, title);
  if (!ok) {
    return Response.json({ error: "conversation not found" }, { status: 404 });
  }
  return Response.json({ ok: true });
}

export async function DELETE(request, { params }) {
  const { id } = await params;
  deleteConversation(id);
  return Response.json({ ok: true });
}
