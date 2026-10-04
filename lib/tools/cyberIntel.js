// Threat intel / cyber news / web fetch — all local (no laptop tools agent
// needed), so these tools are always available regardless of toolsConfigured().

import { addThreatIntel, searchThreatIntel } from "../threatIntel";
import {
  addPlaybook,
  searchPlaybooks,
  startPlaybookDraft,
  addPlaybookDraftStep,
  getPlaybookDraft,
  finalizePlaybookDraft,
  discardPlaybookDraft,
} from "../playbooks";
import {
  startIncidentReport,
  logIncidentEntry,
  getIncidentReportDraft,
  finalizeIncidentReport,
  discardIncidentReport,
  searchIncidentReports,
} from "../incidentReports";
import { fetchWebPage } from "../webFetch";
import {
  addCyberNewsSource,
  listCyberNewsSources,
  removeCyberNewsSource,
  setCyberNewsWatchTerms,
  fetchCyberNews,
} from "../cyberNews";
import threatIntelTool from "../../tools-agent/shared/tools/threatIntel";
import playbooksTool from "../../tools-agent/shared/tools/playbooks";
import incidentReportsTool from "../../tools-agent/shared/tools/incidentReports";
import webFetchTool from "../../tools-agent/shared/tools/webFetch";
import cyberNewsTool from "../../tools-agent/shared/tools/cyberNews";
import urlProvenanceTool from "../../tools-agent/shared/tools/urlProvenance";
import cveTool from "../../tools-agent/shared/tools/cve";
import ipReputationTool from "../../tools-agent/shared/tools/ipReputation";
import urlhausTool from "../../tools-agent/shared/tools/urlhaus";
import fileReputationTool from "../../tools-agent/shared/tools/fileReputation";
import { urlProvenanceConfigured, checkUrlLegitimacy } from "../urlProvenance";
import { lookupCve, searchCves } from "../cve";
import { ipReputationConfigured, checkIpReputation } from "../ipReputation";
import { checkUrlhaus, urlhausConfigured } from "../urlhaus";
import { fileReputationConfigured, checkFileHash } from "../fileReputation";

export const CONFIRM_REQUIRED_TOOLS = new Set([
  ...threatIntelTool.CONFIRM_REQUIRED_TOOLS,
  ...playbooksTool.CONFIRM_REQUIRED_TOOLS,
  ...incidentReportsTool.CONFIRM_REQUIRED_TOOLS,
  ...webFetchTool.CONFIRM_REQUIRED_TOOLS,
  ...cyberNewsTool.CONFIRM_REQUIRED_TOOLS,
  ...urlProvenanceTool.CONFIRM_REQUIRED_TOOLS,
  ...cveTool.CONFIRM_REQUIRED_TOOLS,
  ...ipReputationTool.CONFIRM_REQUIRED_TOOLS,
  ...urlhausTool.CONFIRM_REQUIRED_TOOLS,
  ...fileReputationTool.CONFIRM_REQUIRED_TOOLS,
]);

// The old approach — one blanket "cyber_intel" category covering all 27
// tools here (threat intel, playbooks, incident reports, web fetch, news,
// URL/IP/file reputation, CVEs) — meant a single narrow keyword match
// (e.g. "cyber security news") pulled in every one of those tools' full
// schemas, even the completely unrelated ones. Split into focused
// sub-categories instead, each with its own keyword list, so a message
// only pulls in the tools it's actually plausibly about. Playbooks and
// incident reports stay together since the guidance text explicitly
// depends on the model telling those two tool families apart.
export const SUBCATEGORIES = [
  {
    name: "threat_intel",
    keywords: [
      "threat intel", "ioc", "indicator of compromise", "kill chain",
      "attack technique", "mitigation", "malware hash", "reputation",
    ],
    names: ["lookup_threat_intel", "add_threat_intel"],
  },
  {
    name: "playbooks",
    keywords: [
      "playbook", "runbook", "incident response", "ir plan",
      "response plan", "incident playbook", "security incident",
      "we've been breached", "we have been breached", "suspected compromise",
      "account compromise", "data exfiltration", "malware infection",
      "phishing report", "incident report", "write up the report",
      "after action report", "write the report", "generate the report",
      "incident report history",
    ],
    names: [
      "lookup_playbook", "add_playbook", "start_playbook_draft",
      "add_playbook_step", "view_playbook_draft", "finish_playbook_draft",
      "discard_playbook_draft", "start_incident_report", "log_incident_entry",
      "view_incident_report_draft", "finish_incident_report",
      "discard_incident_report", "lookup_incident_report",
    ],
  },
  {
    name: "web_fetch",
    keywords: [
      "fetch this page", "fetch url", "fetch that page",
      "summarize this article", "read this webpage", "http://", "https://",
    ],
    names: ["fetch_web_page"],
  },
  {
    name: "cyber_news",
    keywords: [
      "cyber news", "cybersecurity news", "security news", "news source",
      "watch term", "news about", "look for news", "any news on",
      "any news about", "latest news", "recent news", "news on", "news for",
      "check the news", "check for news", "search for news", "news feed",
    ],
    names: [
      "get_cyber_news", "add_cyber_news_source", "list_cyber_news_sources",
      "remove_cyber_news_source", "set_cyber_news_watch_terms",
    ],
  },
  {
    name: "url_safety",
    keywords: [
      "is this url safe", "is this link safe", "url legitimacy",
      "url provenance", "shortened url", "suspicious link", "suspicious url",
      "phishing link", "homograph", "punycode", "domain age",
      "is this legit", "is this a scam", "is this website safe",
      "is this site safe", "check this url", "check this link",
      "scan this url", "scan this link", "verify this url", "verify this link",
      "malicious url", "malicious link", "legit website", "legit site",
      "bit.ly", "tinyurl", "urlhaus",
    ],
    names: ["check_url_legitimacy", "check_urlhaus"],
  },
  {
    name: "vuln_lookup",
    keywords: [
      "cve", "exploit", "vulnerability", "breach", "ransomware",
      "nvd", "national vulnerability database", "cwe", "cvss",
    ],
    names: ["lookup_cve", "search_cves"],
  },
  {
    name: "reputation",
    keywords: [
      "virustotal", "abuseipdb", "ip reputation", "abusive ip",
      "malicious ip", "check this ip", "is this ip safe", "file hash",
      "check this hash", "file reputation", "malware sample",
    ],
    names: ["check_ip_reputation", "check_file_hash"],
  },
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
    // lookup_playbook/add_playbook definitions live in the shared
    // assistant-tools submodule (tools-agent/shared/tools/playbooks.js)
    // so they stay in sync with the other project using the same tool.
    ...Object.values(playbooksTool.toolDefinitions).map((fn) => ({
      type: "function",
      function: fn,
    })),
    // start_incident_report/log_incident_entry/finish_incident_report/
    // lookup_incident_report definitions live in the shared assistant-
    // tools submodule (tools-agent/shared/tools/incidentReports.js) —
    // companion to playbooks.js for tracking and writing up real
    // incidents as they happen.
    ...Object.values(incidentReportsTool.toolDefinitions).map((fn) => ({
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
    // cyberNews.js) so they stay in sync with the other project that uses the same
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
  // lookup_cve/search_cves (NVD) need no API key — always available.
  defs.push(
    ...Object.values(cveTool.toolDefinitions).map((fn) => ({
      type: "function",
      function: fn,
    }))
  );
  // check_ip_reputation needs ABUSEIPDB_API_KEY.
  if (ipReputationConfigured()) {
    defs.push(
      ...Object.values(ipReputationTool.toolDefinitions).map((fn) => ({
        type: "function",
        function: fn,
      }))
    );
  }
  // check_urlhaus needs URLHAUS_AUTH_KEY (free registration required as of 2025).
  if (urlhausConfigured()) {
    defs.push(
      ...Object.values(urlhausTool.toolDefinitions).map((fn) => ({
        type: "function",
        function: fn,
      }))
    );
  }
  // check_file_hash reuses VIRUSTOTAL_API_KEY (same key as check_url_legitimacy).
  if (fileReputationConfigured()) {
    defs.push(
      ...Object.values(fileReputationTool.toolDefinitions).map((fn) => ({
        type: "function",
        function: fn,
      }))
    );
  }
  return defs;
}

export function describe(name, args) {
  return (
    threatIntelTool.describeToolCall(name, args) ||
    playbooksTool.describeToolCall(name, args) ||
    incidentReportsTool.describeToolCall(name, args) ||
    webFetchTool.describeToolCall(name, args) ||
    cyberNewsTool.describeToolCall(name, args) ||
    urlProvenanceTool.describeToolCall(name, args) ||
    cveTool.describeToolCall(name, args) ||
    ipReputationTool.describeToolCall(name, args) ||
    urlhausTool.describeToolCall(name, args) ||
    fileReputationTool.describeToolCall(name, args) ||
    undefined
  );
}

export async function execute(name, args, ctx = {}) {
  switch (name) {
    case "lookup_threat_intel":
      return { results: searchThreatIntel(args.query, args.limit) };
    case "add_threat_intel":
      return addThreatIntel(args);
    case "lookup_playbook":
      return { results: searchPlaybooks(args.query, args.limit) };
    case "add_playbook":
      return addPlaybook({ ...args, requiresReport: args.requires_report });
    case "start_playbook_draft":
      return startPlaybookDraft(ctx.conversationId, {
        ...args,
        requiresReport: args.requires_report,
      });
    case "add_playbook_step":
      return addPlaybookDraftStep(ctx.conversationId, { step: args.step, section: args.section });
    case "view_playbook_draft": {
      const draft = getPlaybookDraft(ctx.conversationId);
      return draft || { message: "No playbook draft is in progress for this conversation." };
    }
    case "finish_playbook_draft":
      return finalizePlaybookDraft(ctx.conversationId, args);
    case "discard_playbook_draft":
      return { discarded: discardPlaybookDraft(ctx.conversationId) };
    case "start_incident_report":
      return startIncidentReport(ctx.conversationId, {
        ...args,
        playbookTitle: args.playbook_title,
      });
    case "log_incident_entry":
      return logIncidentEntry(ctx.conversationId, args);
    case "view_incident_report_draft": {
      const draft = getIncidentReportDraft(ctx.conversationId);
      return draft || { message: "No incident is currently being tracked for this conversation." };
    }
    case "finish_incident_report":
      return finalizeIncidentReport(ctx.conversationId, {
        ...args,
        playbookTitle: args.playbook_title,
      });
    case "discard_incident_report":
      return { discarded: discardIncidentReport(ctx.conversationId) };
    case "lookup_incident_report":
      return { results: searchIncidentReports(args.query, args.limit) };
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
    case "lookup_cve":
      return lookupCve(args.cve_id);
    case "search_cves":
      return searchCves(args.keyword, { limit: args.limit, exact_match: args.exact_match });
    case "check_ip_reputation":
      return checkIpReputation(args.ip, { max_age_days: args.max_age_days, verbose: args.verbose });
    case "check_urlhaus":
      return checkUrlhaus({ url: args.url, host: args.host, hash: args.hash });
    case "check_file_hash":
      return checkFileHash(args.hash);
    default:
      return undefined;
  }
}

export const NAMES = new Set([
  "lookup_threat_intel",
  "add_threat_intel",
  "lookup_playbook",
  "add_playbook",
  "start_playbook_draft",
  "add_playbook_step",
  "view_playbook_draft",
  "finish_playbook_draft",
  "discard_playbook_draft",
  "start_incident_report",
  "log_incident_entry",
  "view_incident_report_draft",
  "finish_incident_report",
  "discard_incident_report",
  "lookup_incident_report",
  "fetch_web_page",
  "get_cyber_news",
  "add_cyber_news_source",
  "list_cyber_news_sources",
  "remove_cyber_news_source",
  "set_cyber_news_watch_terms",
  "check_url_legitimacy",
  "lookup_cve",
  "search_cves",
  "check_ip_reputation",
  "check_urlhaus",
  "check_file_hash",
]);
