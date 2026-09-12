import { updateReminder, deleteReminder } from "@/lib/reminders";

export async function PATCH(request, { params }) {
  const { id } = await params;
  const body = await request.json().catch(() => ({}));
  try {
    const reminder = updateReminder(id, body);
    return Response.json({ reminder });
  } catch (err) {
    return Response.json({ error: err.message }, { status: 400 });
  }
}

export async function DELETE(request, { params }) {
  const { id } = await params;
  const result = deleteReminder(id);
  return Response.json(result);
}
