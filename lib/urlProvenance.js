// Thin adapter over the shared assistant-tools urlProvenance module — see
// tools-agent/shared/tools/urlProvenance.js for the actual implementation.
// Injects the VirusTotal API key from env the same way lib/shodan.js injects
// its API key.
import urlProvenanceTool from "../tools-agent/shared/tools/urlProvenance";

const API_KEY = process.env.VIRUSTOTAL_API_KEY || "";

export function virusTotalConfigured() {
  return Boolean(API_KEY);
}

export function checkUrlLegitimacy(url) {
  return urlProvenanceTool.checkUrlLegitimacy(API_KEY, url);
}
