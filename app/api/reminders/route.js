// Reminders management API — backs the "Reminders" panel in the web UI so
// the user can create/view/edit/cancel custom (including cron) schedules
// directly, without going through chat. Protected by the same auth proxy as
// every other /api/* route (see proxy.js).

import { createReminder, getAllReminders } from "@/lib/reminders";

export async function GET() {
  return Response.json({ reminders: getAllReminders() });
}

export async function POST(request) {
  const body = await request.json().catch(() => ({}));
  try {
    const reminder = createReminder(body);
    return Response.json({ reminder });
  } catch (err) {
    return Response.json({ error: err.message }, { status: 400 });
  }
}
