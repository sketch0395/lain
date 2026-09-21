// Thin adapter over the shared assistant-tools cve module — see
// tools-agent/shared/tools/cve.js for the actual implementation. Injects
// the optional NVD API key from env the same way lib/shodan.js injects
// its API key. No key required — NVD's API is free/public — but one
// raises the rate limit from 5 to 50 requests/30s.
import cveTool from "../tools-agent/shared/tools/cve";

const API_KEY = process.env.NVD_API_KEY || "";

export function lookupCve(cveId) {
  return cveTool.lookupCve(API_KEY, cveId);
}

export function searchCves(keyword, opts) {
  return cveTool.searchCves(API_KEY, keyword, opts);
}
