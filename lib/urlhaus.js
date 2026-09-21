// Thin adapter over the shared assistant-tools urlhaus module — see
// tools-agent/shared/tools/urlhaus.js for the actual implementation.
// URLhaus requires a free Auth-Key (register at https://auth.abuse.ch/),
// injected here the same way lib/shodan.js injects its API key.
import urlhausTool from "../tools-agent/shared/tools/urlhaus";

const API_KEY = process.env.URLHAUS_AUTH_KEY || "";

export function urlhausConfigured() {
  return Boolean(API_KEY);
}

export function checkUrlhaus({ url, host, hash } = {}) {
  if (url) return urlhausTool.checkUrl(API_KEY, url);
  if (host) return urlhausTool.checkHost(API_KEY, host);
  if (hash) return urlhausTool.checkPayloadHash(API_KEY, hash);
  throw new Error("One of url/host/hash is required");
}
