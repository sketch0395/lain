import { getVapidPublicKey, pushConfigured } from "@/lib/push";

export async function GET() {
  return Response.json({ configured: pushConfigured(), publicKey: getVapidPublicKey() });
}
