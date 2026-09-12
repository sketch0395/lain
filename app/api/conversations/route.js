import { listConversations } from "@/lib/conversations";

export async function GET() {
  return Response.json(listConversations());
}
