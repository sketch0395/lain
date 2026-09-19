// Network diagnostics/lookups (all via the laptop tools agent) plus Shodan
// lookups (a direct API call, independent of the laptop agent).
//
// The actual tool schemas/dispatch logic live in the shared assistant-tools
// submodule (tools-agent/shared/app-tools/network.js) so they stay in sync
// with other projects that use the same tools (Asuna) — this file just
// injects this app's own httpClient (LAIN_TOOLS_URL/TOKEN) and Shodan
// adapter.
import {
  shodanConfigured,
  shodanHostLookup,
  shodanSearch,
  shodanDnsLookup,
  shodanAccountInfo,
} from "../shodan";
import { fetchToolsAgent } from "./httpClient";
import sharedNetwork from "../../tools-agent/shared/app-tools/network";

export const CONFIRM_REQUIRED_TOOLS = sharedNetwork.CONFIRM_REQUIRED_TOOLS;
export const CATEGORY_KEYWORDS = sharedNetwork.CATEGORY_KEYWORDS;
export const NAMES = sharedNetwork.NAMES;

export function getDefinitions({ toolsConfigured }) {
  return sharedNetwork.getDefinitions({
    toolsConfigured,
    shodanConfigured: shodanConfigured(),
  });
}

export function describe(name, args) {
  return sharedNetwork.describe(name, args);
}

export async function execute(name, args) {
  return sharedNetwork.execute(name, args, {
    fetchToolsAgent,
    shodan: { shodanHostLookup, shodanSearch, shodanDnsLookup, shodanAccountInfo },
  });
}
