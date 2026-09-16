// Shared HTTP client for talking to the `lain-tools-agent` running on the
// user's laptop — a small, read-only/token-authenticated HTTP service. Every
// category module under lib/tools/ that dispatches to the laptop agent
// (forensics, network, omarchy, plus create_note/update_lain) goes through
// these helpers so the URL/auth/timeout/error-handling logic only lives in
// one place. See tools-agent/server.js for the implementation.

const TOOLS_URL = process.env.LAIN_TOOLS_URL || "";
const TOOLS_TOKEN = process.env.LAIN_TOOLS_TOKEN || "";

export function toolsConfigured() {
  return Boolean(TOOLS_URL && TOOLS_TOKEN);
}

function authHeaders() {
  return { Authorization: `Bearer ${TOOLS_TOKEN}` };
}

/** GET a laptop-agent endpoint with query params, return parsed JSON body. */
export async function fetchToolsAgent(path, params = {}, { timeoutMs = 10000 } = {}) {
  if (!toolsConfigured()) {
    throw new Error(
      "Tools agent is not configured (set LAIN_TOOLS_URL/LAIN_TOOLS_TOKEN)."
    );
  }
  const searchParams = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== "") {
      searchParams.set(key, String(value));
    }
  }
  const qs = searchParams.toString();
  const url = qs ? `${TOOLS_URL}${path}?${qs}` : `${TOOLS_URL}${path}`;
  const res = await fetch(url, {
    headers: authHeaders(),
    signal: AbortSignal.timeout(timeoutMs),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(body.error || `Tools agent responded with ${res.status}`);
  }
  return body;
}

/** POST a JSON body to a laptop-agent endpoint, return parsed JSON body. */
export async function postToolsAgent(path, body = {}, { timeoutMs = 10000 } = {}) {
  if (!toolsConfigured()) {
    throw new Error(
      "Tools agent is not configured (set LAIN_TOOLS_URL/LAIN_TOOLS_TOKEN)."
    );
  }
  const res = await fetch(`${TOOLS_URL}${path}`, {
    method: "POST",
    headers: { ...authHeaders(), "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  });
  const parsed = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(parsed.error || `Tools agent responded with ${res.status}`);
  }
  return parsed;
}

/** GET a laptop-agent endpoint built via a pre-formed searchParams string (used for the shared files.js buildRequest shape). */
export async function fetchToolsAgentRaw(pathWithQuery, { timeoutMs = 10000 } = {}) {
  if (!toolsConfigured()) {
    throw new Error(
      "Tools agent is not configured (set LAIN_TOOLS_URL/LAIN_TOOLS_TOKEN)."
    );
  }
  const res = await fetch(`${TOOLS_URL}${pathWithQuery}`, {
    headers: authHeaders(),
    signal: AbortSignal.timeout(timeoutMs),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(body.error || `Tools agent responded with ${res.status}`);
  }
  return body;
}

/** Best-effort desktop notification via the laptop tools agent (used by lib/notify.js). */
export async function notifyLaptop(title, body) {
  if (!toolsConfigured()) return false;
  try {
    const res = await fetch(`${TOOLS_URL}/notify`, {
      method: "POST",
      headers: { ...authHeaders(), "Content-Type": "application/json" },
      body: JSON.stringify({ title, body }),
      signal: AbortSignal.timeout(8000),
    });
    return res.ok;
  } catch {
    return false;
  }
}

export async function toolsReachable() {
  if (!toolsConfigured()) return false;
  try {
    const res = await fetch(`${TOOLS_URL}/health`, {
      headers: authHeaders(),
      signal: AbortSignal.timeout(5000),
    });
    return res.ok;
  } catch {
    return false;
  }
}
