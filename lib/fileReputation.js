// Thin adapter over the shared assistant-tools fileReputation module —
// see tools-agent/shared/tools/fileReputation.js for the actual
// implementation. Reuses the same VIRUSTOTAL_API_KEY lib/urlProvenance.js
// already injects for check_url_legitimacy.
import fileReputationTool from "../tools-agent/shared/tools/fileReputation";

const VT_API_KEY = process.env.VIRUSTOTAL_API_KEY || "";

export function fileReputationConfigured() {
  return Boolean(VT_API_KEY);
}

export function checkFileHash(hash) {
  return fileReputationTool.checkFileHash(VT_API_KEY, hash);
}
