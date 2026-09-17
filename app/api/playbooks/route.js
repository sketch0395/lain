// Playbook admin API — backs the "Playbooks" panel so the user can see
// what incident response runbooks exist (phishing, ransomware, account
// compromise, etc.), add/transcribe new ones, or remove them. This is the
// human-curated side; Lain reads it back via the lookup_playbook tool
// (see lib/tools/cyberIntel.js) and follows the steps when a matching
// incident is described. Protected by the same auth proxy as every other
// /api/* route (see proxy.js).

import { addPlaybook, listPlaybooks, listPlaybookCategories } from "@/lib/playbooks";

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const category = searchParams.get("category") || null;
  return Response.json({
    entries: listPlaybooks(category),
    categories: listPlaybookCategories(),
  });
}

export async function POST(request) {
  const body = await request.json().catch(() => ({}));
  try {
    const entry = addPlaybook(body);
    return Response.json({ entry });
  } catch (err) {
    return Response.json({ error: err.message }, { status: 400 });
  }
}
