import { listAlerts } from "@/lib/alerts";

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  try {
    return Response.json({
      alerts: listAlerts({ status: searchParams.get("status") || undefined, limit: searchParams.get("limit") }),
    });
  } catch (err) {
    return Response.json({ error: err.message }, { status: 400 });
  }
}
