// Proxies a one-time sudo password to the local tools agent so it can grant
// tcpdump packet-capture permissions (cap_net_raw/cap_net_admin), enabling
// the capture_packets tool without running the agent as root.
//
// Deliberately separate from lib/tools.js / the chat/LLM flow: this route
// is only ever called directly from GrantCapturePermissionModal.js, so a
// user's sudo password never becomes a tool-call argument, never enters
// the conversation history (SQLite), and is never sent to the Ollama
// model. It's forwarded here, straight to the agent, and then discarded —
// this route doesn't log the request body or persist the password
// anywhere.
//
// Protected by the same auth proxy as every other /api/* route (see
// proxy.js).

const TOOLS_URL = process.env.LAIN_TOOLS_URL || "";
const TOOLS_TOKEN = process.env.LAIN_TOOLS_TOKEN || "";

export async function POST(request) {
  if (!TOOLS_URL || !TOOLS_TOKEN) {
    return Response.json(
      { error: "The tools agent isn't configured (LAIN_TOOLS_URL/LAIN_TOOLS_TOKEN)." },
      { status: 503 }
    );
  }

  const body = await request.json().catch(() => ({}));
  if (!body.password || typeof body.password !== "string") {
    return Response.json({ error: "password is required" }, { status: 400 });
  }

  let res;
  try {
    res = await fetch(`${TOOLS_URL}/grant-capture-permission`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${TOOLS_TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ password: body.password }),
      signal: AbortSignal.timeout(15000),
    });
  } catch (err) {
    return Response.json(
      { error: `Could not reach the tools agent: ${err.message}` },
      { status: 502 }
    );
  }

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    return Response.json(
      { error: data.error || `Tools agent responded with ${res.status}` },
      { status: res.status }
    );
  }
  return Response.json(data);
}
