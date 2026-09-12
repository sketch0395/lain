import { saveSubscription, removeSubscription } from "@/lib/push";

export async function POST(request) {
  const { subscription } = await request.json();
  if (!subscription?.endpoint) {
    return Response.json({ error: "subscription is required" }, { status: 400 });
  }
  try {
    saveSubscription(subscription);
  } catch (err) {
    return Response.json({ error: err.message }, { status: 400 });
  }
  return Response.json({ ok: true });
}

export async function DELETE(request) {
  const { endpoint } = await request.json();
  if (!endpoint) {
    return Response.json({ error: "endpoint is required" }, { status: 400 });
  }
  removeSubscription(endpoint);
  return Response.json({ ok: true });
}
