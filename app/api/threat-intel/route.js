// Threat Intel admin API — backs the "Threat Intel" panel so the user can
// see what's in Lain's curated cyber threat reference library (kill chain
// phases, attack techniques, IOCs, mitigations, etc.), add entries, or
// remove them. This is the human-curated side; Lain reads it back via the
// lookup_threat_intel tool (see lib/tools.js). Protected by the same auth
// proxy as every other /api/* route (see proxy.js).

import {
  addThreatIntel,
  listThreatIntel,
  listThreatIntelCategories,
} from "@/lib/threatIntel";

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const category = searchParams.get("category") || null;
  return Response.json({
    entries: listThreatIntel(category),
    categories: listThreatIntelCategories(),
  });
}

export async function POST(request) {
  const body = await request.json().catch(() => ({}));
  try {
    const entry = addThreatIntel(body);
    return Response.json({ entry });
  } catch (err) {
    return Response.json({ error: err.message }, { status: 400 });
  }
}
