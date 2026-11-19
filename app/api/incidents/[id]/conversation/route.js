// Starts a fresh chat scoped to an incident: creates a conversation, links
// it to the case, and returns its id so the UI can open it via /?c=<id>.
import { ensureConversation } from "@/lib/conversations";
import { getIncident, linkConversation } from "@/lib/incidents";

export async function POST(request, { params }) {
  const { id } = await params;
  const incidentId = Number(id);
  const incident = getIncident(incidentId);
  if (!incident) return Response.json({ error: "Not found" }, { status: 404 });
  const conversationId = ensureConversation(null, `Incident #${incidentId}: ${incident.title}`);
  linkConversation(incidentId, conversationId);
  return Response.json({ conversationId });
}
