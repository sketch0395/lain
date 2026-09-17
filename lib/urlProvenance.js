// Thin adapter over the shared assistant-tools urlProvenance module — see
// tools-agent/shared/tools/urlProvenance.js for the actual implementation.
// Injects the VirusTotal + urlscan.io API keys from env the same way
// lib/shodan.js injects its API key.
import urlProvenanceTool from "../tools-agent/shared/tools/urlProvenance";

const VT_API_KEY = process.env.VIRUSTOTAL_API_KEY || "";
const URLSCAN_API_KEY = process.env.URLSCAN_API_KEY || "";

export function virusTotalConfigured() {
  return Boolean(VT_API_KEY);
}

export function urlscanConfigured() {
  return Boolean(URLSCAN_API_KEY);
}

// The tool is useful with either signal alone (RDAP/homograph checks always
// run regardless), so expose it once at least one paid API is wired up.
export function urlProvenanceConfigured() {
  return virusTotalConfigured() || urlscanConfigured();
}

export function checkUrlLegitimacy(url) {
  return urlProvenanceTool.checkUrlLegitimacy(
    { virusTotalApiKey: VT_API_KEY, urlscanApiKey: URLSCAN_API_KEY },
    url
  );
}
