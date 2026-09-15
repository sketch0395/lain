// Thin adapter over the shared assistant-tools shodan module — see
// tools-agent/shared/tools/shodan.js for the actual implementation. Injects
// the API key from env the same way lib/cyberNews.js injects a db handle.
import shodanTool from "../tools-agent/shared/tools/shodan";

const API_KEY = process.env.SHODAN_API_KEY || "";

export function shodanConfigured() {
  return Boolean(API_KEY);
}

export function shodanHostLookup(ip, opts) {
  return shodanTool.shodanHostLookup(API_KEY, ip, opts);
}

export function shodanSearch(query, opts) {
  return shodanTool.shodanSearch(API_KEY, query, opts);
}

export function shodanDnsLookup(hostnames) {
  return shodanTool.shodanDnsLookup(API_KEY, hostnames);
}

export function shodanAccountInfo() {
  return shodanTool.shodanAccountInfo(API_KEY);
}
