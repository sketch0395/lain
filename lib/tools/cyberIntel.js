// Threat intel / cyber news / web fetch — all local (no laptop tools agent
// needed), so these tools are always available regardless of toolsConfigured().

import { addThreatIntel, searchThreatIntel } from "../threatIntel";
import { fetchWebPage } from "../webFetch";
import {
  addCyberNewsSource,
  listCyberNewsSources,
  removeCyberNewsSource,
  setCyberNewsWatchTerms,
  fetchCyberNews,
} from "../cyberNews";
import threatIntelTool from "../../tools-agent/shared/tools/threatIntel";
import webFetchTool from "../../tools-agent/shared/tools/webFetch";
import cyberNewsTool from "../../tools-agent/shared/tools/cyberNews";
import urlProvenanceTool from "../../tools-agent/shared/tools/urlProvenance";
import { urlProvenanceConfigured, checkUrlLegitimacy } from "../urlProvenance";

export const CONFIRM_REQUIRED_TOOLS = new Set([
  ...threatIntelTool.CONFIRM_REQUIRED_TOOLS,
  ...webFetchTool.CONFIRM_REQUIRED_TOOLS,
  ...cyberNewsTool.CONFIRM_REQUIRED_TOOLS,
  ...urlProvenanceTool.CONFIRM_REQUIRED_TOOLS,
]);

export const CATEGORY_KEYWORDS = [
  "virustotal", "threat intel", "ioc", "indicator of compromise",
  "malware hash", "reputation", "fetch this page", "fetch url",
  "fetch that page", "summarize this article", "read this webpage",
  "cyber news", "cybersecurity news", "security news", "cve", "exploit",
  "vulnerability", "breach", "ransomware", "news source", "watch term",
  "is this url safe", "is this link safe", "url legitimacy", "url provenance",
  "shortened url", "suspicious link", "suspicious url", "phishing link",
  "homograph", "punycode", "domain age", "is this legit", "is this a scam",
  "is this website safe", "is this site safe", "check this url",
  "check this link", "scan this url", "scan this link", "verify this url",
  "verify this link", "malicious url", "malicious link", "legit website",
  "legit site", "bit.ly", "tinyurl", "http://", "https://",
];

/** Tool definitions in this category — always available (no laptop agent required). */
export function getDefinitions() {
  const defs = [
    // lookup_threat_intel/add_threat_intel and fetch_web_page definitions
    // live in the shared assistant-tools submodule (tools-agent/shared/
    // tools/threatIntel.js, tools/webFetch.js) so they stay in sync with
    // other projects that use the same tools — see those files for
    // descriptions.
    ...Object.values(threatIntelTool.toolDefinitions).map((fn) => ({
      type: "function",
      function: fn,
    })),
    ...Object.values(webFetchTool.toolDefinitions).map((fn) => ({
      type: "function",
      function: fn,
    })),
    // get_cyber_news/add_cyber_news_source/list_cyber_news_sources/
    // remove_cyber_news_source/set_cyber_news_watch_terms definitions live
    // in the shared assistant-tools submodule (tools-agent/shared/tools/
    // cyberNews.js) so they stay in sync with Asuna, which uses the same
    // tool — see that file for descriptions.
    ...Object.values(cyberNewsTool.toolDefinitions).map((fn) => ({
      type: "function",
      function: fn,
    })),
  ];
  // check_url_legitimacy needs at least one of VIRUSTOTAL_API_KEY/
  // URLSCAN_API_KEY to produce a useful verdict — gated the same way
  // network.js gates the Shodan tools on shodanConfigured().
  if (urlProvenanceConfigured()) {
    defs.push({ type: "function", function: urlProvenanceTool.toolDefinition });
  }
  return defs;
}

export function describe(name, args) {
  return (
    threatIntelTool.describeToolCall(name, args) ||
    webFetchTool.describeToolCall(name, args) ||
    cyberNewsTool.describeToolCall(name, args) ||
    urlProvenanceTool.describeToolCall(name, args) ||
    undefined
  );
}

export async function execute(name, args) {
  switch (name) {
    case "lookup_threat_intel":
      return { results: searchThreatIntel(args.query, args.limit) };
    case "add_threat_intel":
      return addThreatIntel(args);
    case "fetch_web_page":
      return fetchWebPage(args.url);
    case "get_cyber_news":
      return fetchCyberNews({ topic: args.topic, limit: args.limit });
    case "add_cyber_news_source":
      return addCyberNewsSource(args.name, args.url);
    case "list_cyber_news_sources":
      return { sources: listCyberNewsSources() };
    case "remove_cyber_news_source":
      return { removed: removeCyberNewsSource(args.name_or_url) };
    case "set_cyber_news_watch_terms":
      return { watch_terms: setCyberNewsWatchTerms(args.watch_terms) };
    case "check_url_legitimacy":
      return checkUrlLegitimacy(args.url);
    default:
      return undefined;
  }
}

export const NAMES = new Set([
  "lookup_threat_intel",
  "add_threat_intel",
  "fetch_web_page",
  "get_cyber_news",
  "add_cyber_news_source",
  "list_cyber_news_sources",
  "remove_cyber_news_source",
  "set_cyber_news_watch_terms",
  "check_url_legitimacy",
]);
