// Thin adapter over the shared assistant-tools ipReputation module — see
// tools-agent/shared/tools/ipReputation.js for the actual implementation.
// Injects the API key from env the same way lib/shodan.js injects its key.
import ipReputationTool from "../tools-agent/shared/tools/ipReputation";

const API_KEY = process.env.ABUSEIPDB_API_KEY || "";

export function ipReputationConfigured() {
  return Boolean(API_KEY);
}

export function checkIpReputation(ip, opts) {
  return ipReputationTool.checkIpReputation(API_KEY, ip, opts);
}
