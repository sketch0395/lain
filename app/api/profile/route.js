// "About me" profile API — backs the "About Me" panel in the web UI so
// Lain can personalize replies with the user's name, birthday, occupation,
// links, etc. Protected by the same auth proxy as every other /api/* route
// (see proxy.js).

import { getProfile, saveProfile } from "@/lib/profile";

export async function GET() {
  return Response.json({ profile: getProfile() });
}

export async function PUT(request) {
  const body = await request.json().catch(() => ({}));
  const profile = saveProfile(body);
  return Response.json({ profile });
}
