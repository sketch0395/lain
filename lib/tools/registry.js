// Aggregates all lib/tools/* category modules into the exact same public
// API previously exposed directly by lib/tools.js — see ../tools.js, which
// now just re-exports everything from here. See ../../TOOLS.md for the
// full tool reference table.
//
// Each category module (core, network, forensics, omarchy, cyberIntel,
// systemUpdate) exports: getDefinitions(flags), describe(name, args),
// execute(name, args, ctx), CONFIRM_REQUIRED_TOOLS (Set), CATEGORY_KEYWORDS
// (array), NAMES (Set of tool names it owns).

import {
  toolsConfigured,
  notifyLaptop,
  toolsReachable,
} from "./httpClient";
import * as core from "./core";
import * as network from "./network";
import * as forensics from "./forensics";
import * as omarchy from "./omarchy";
import * as cyberIntel from "./cyberIntel";
import * as systemUpdate from "./systemUpdate";
import * as diagnostics from "./diagnostics";
import * as graphs from "./graphs";
import * as obsidian from "./obsidian";
import { logToolCall } from "../toolCallLog";

const CATEGORIES = [core, network, forensics, omarchy, cyberIntel, systemUpdate, diagnostics, graphs, obsidian];

export { toolsConfigured, notifyLaptop, toolsReachable };

/** All tool definitions currently available to the model. */
export function getToolDefinitions() {
  const flags = { toolsConfigured: toolsConfigured() };
  return CATEGORIES.flatMap((mod) => mod.getDefinitions(flags));
}

// Sending every tool's full JSON schema on every single request adds up —
// at last count this is ~50 tools and roughly 9k+ tokens, more than half
// of a 16k context window, before the system prompt/history/message are
// even added. That token pressure makes tool-calling less reliable
// (and, combined with a longer conversation, more prone to the model
// losing track and hallucinating instead of calling a real tool). Rather
// than always sending everything, group tools into topical categories and
// only send the ones plausibly relevant to what the user actually just
// asked — always including a small "always on" set of cheap, frequently
// used utility tools regardless of topic. If nothing matches, that's most
// often genuinely just small talk/plain conversation with no tool need at
// all (verified: this fallback was firing on messages like "what about
// with a regular chat?" and burning ~14k tokens sending literally every
// tool for a message that needed none of them) — so fall back to just the
// always-on set rather than the entire catalog. This is a judgment call
// that trades a small chance of a genuinely ambiguous-but-tool-needing
// message missing its category for a large, much more common savings on
// ordinary chit-chat; if a real gap shows up, the fix is to add a keyword/
// pattern to the relevant category, not to widen this fallback back out.

// Cheap, frequently-used utility tools that stay available no matter what
// the message is about — leaving these out on a false-negative keyword
// miss would be far more disruptive than the tiny token cost of always
// including them.
const ALWAYS_INCLUDE_TOOLS = new Set([
  "create_note",
  "create_reminder",
  "list_reminders",
  "cancel_reminder",
  "get_news",
  "remember_fact",
  "diagnose_tool_calls",
  "send_email",
]);

// name -> category, built from each module's NAMES set (core tools are
// omitted since they're always-include and never filtered out).
const TOOL_CATEGORIES = {};
const CATEGORY_NAME_BY_MODULE = new Map([
  [network, "network"],
  [forensics, "forensics"],
  [omarchy, "omarchy"],
  [systemUpdate, "system_update"],
  [graphs, "graphs"],
  [obsidian, "obsidian"],
]);
for (const [mod, categoryName] of CATEGORY_NAME_BY_MODULE) {
  for (const name of mod.NAMES) TOOL_CATEGORIES[name] = [categoryName];
}
// cyberIntel is split into several focused sub-categories (see
// SUBCATEGORIES in cyberIntel.js) instead of one blanket category, so a
// narrow request like "cyber security news" doesn't pull in unrelated
// tools like playbooks/incident-report drafting.
for (const { name, names } of cyberIntel.SUBCATEGORIES) {
  for (const toolName of names) TOOL_CATEGORIES[toolName] = [name];
}

const CATEGORY_KEYWORDS = {
  forensics: forensics.CATEGORY_KEYWORDS,
  network: network.CATEGORY_KEYWORDS,
  omarchy: omarchy.CATEGORY_KEYWORDS,
  system_update: systemUpdate.CATEGORY_KEYWORDS,
  graphs: graphs.CATEGORY_KEYWORDS,
  obsidian: obsidian.CATEGORY_KEYWORDS,
  ...Object.fromEntries(cyberIntel.SUBCATEGORIES.map((s) => [s.name, s.keywords])),
};

// Free-text keyword matching misses the single most common real-world
// phrasing for these lookups: the user just pastes the IP/hash/CVE ID
// itself ("what is this ip? 1.2.3.4") without ever saying a trigger
// phrase like "ip reputation" or "check this ip". Detecting the literal
// pattern is far more reliable than trying to enumerate every possible
// sentence shape, and prevents falling through to the expensive "send
// every tool" fallback for what's actually a very narrow, common request.
const IPV4_RE = /\b(?:\d{1,3}\.){3}\d{1,3}\b/;
const IPV6_RE = /\b[0-9a-f]{0,4}(?::[0-9a-f]{0,4}){3,7}\b/i;
const HASH_RE = /\b[a-f0-9]{32}\b|\b[a-f0-9]{40}\b|\b[a-f0-9]{64}\b/i;
const CVE_RE = /\bcve-\d{4}-\d{4,7}\b/i;
const URL_RE = /\bhttps?:\/\/\S+/i;

// Exported so lib/promptSkills.js can gate system-prompt guidance text on
// the exact same category matches used to gate tool schemas below — keeps
// "the model was told how to use X" and "the model was actually given X's
// schema" from drifting out of sync.
export function matchedCategories(text) {
  const lower = text.toLowerCase();
  const matched = new Set();
  for (const [category, keywords] of Object.entries(CATEGORY_KEYWORDS)) {
    if (keywords.some((kw) => lower.includes(kw))) matched.add(category);
  }
  if (IPV4_RE.test(text) || IPV6_RE.test(text)) {
    matched.add("network");
    matched.add("reputation");
  }
  if (HASH_RE.test(text)) {
    matched.add("reputation");
    matched.add("url_safety");
  }
  if (CVE_RE.test(text)) {
    matched.add("vuln_lookup");
  }
  if (URL_RE.test(text)) {
    matched.add("web_fetch");
    matched.add("url_safety");
  }
  return matched;
}

/**
 * Same tool set as getToolDefinitions(), but trimmed down to only the
 * categories plausibly relevant to userText — plus the small always-on
 * utility set. Falls back to just the always-on set (not the full catalog)
 * if userText is missing/blank or doesn't match any category — see the
 * comment above ALWAYS_INCLUDE_TOOLS for why.
 */
export function selectToolDefinitions(userText) {
  const defs = getToolDefinitions();
  const alwaysOn = defs.filter((d) => ALWAYS_INCLUDE_TOOLS.has(d.function?.name));
  if (!userText || !userText.trim()) return alwaysOn;

  const categories = matchedCategories(userText);
  if (categories.size === 0) return alwaysOn;

  const filtered = defs.filter((d) => {
    const name = d.function?.name;
    if (ALWAYS_INCLUDE_TOOLS.has(name)) return true;
    const cats = TOOL_CATEGORIES[name];
    return cats ? cats.some((c) => categories.has(c)) : false;
  });
  return filtered.length ? filtered : alwaysOn;
}

// Tools that mutate state (or the laptop tools agent's read of the user's
// filesystem) always require an explicit Allow/Deny before running.
// Read-only reminder/news lookups execute immediately.
const CONFIRM_REQUIRED_TOOLS = new Set([
  ...core.CONFIRM_REQUIRED_TOOLS,
  ...network.CONFIRM_REQUIRED_TOOLS,
  ...forensics.CONFIRM_REQUIRED_TOOLS,
  ...omarchy.CONFIRM_REQUIRED_TOOLS,
  ...cyberIntel.CONFIRM_REQUIRED_TOOLS,
  ...systemUpdate.CONFIRM_REQUIRED_TOOLS,
  ...obsidian.CONFIRM_REQUIRED_TOOLS,
]);

export function requiresConfirmation(name) {
  return CONFIRM_REQUIRED_TOOLS.has(name);
}

export function parseArgs(raw) {
  if (!raw) return {};
  if (typeof raw === "string") {
    try {
      return JSON.parse(raw);
    } catch {
      return {};
    }
  }
  return raw;
}

/** Human-readable one-liner describing a tool call, for confirmation prompts + history. */
export function describeToolCall(name, rawArgs) {
  const args = parseArgs(rawArgs);
  for (const mod of CATEGORIES) {
    const desc = mod.describe(name, args);
    if (desc) return desc;
  }
  return `run ${name}`;
}

/** Executes any tool call — reminder/news/threat-intel tools run locally, laptop-agent tools hit the laptop's tools-agent HTTP service. */
export async function executeTool(name, rawArgs, ctx = {}) {
  const args = parseArgs(rawArgs);
  const startedAt = Date.now();
  for (const mod of CATEGORIES) {
    let result;
    try {
      result = await mod.execute(name, args, ctx);
    } catch (err) {
      // This module owns `name` (it attempted execution rather than
      // silently deferring to the next one) — record the real failure so
      // diagnose_tool_calls can surface it later, then let it propagate as
      // before (callers still see/handle the thrown error the same way).
      logToolCall({
        name,
        args,
        success: false,
        error: err.message,
        durationMs: Date.now() - startedAt,
        conversationId: ctx.conversationId,
      });
      throw err;
    }
    if (result !== undefined) {
      // Some tools return an `{ error: "..." }` object instead of throwing
      // (e.g. a 404 from a lookup) — that's a real failure and needs to
      // show up in diagnose_tool_calls the same as a thrown error, or it's
      // invisible until someone manually inspects the args/result (this bit
      // us with read_obsidian_note silently 404ing on a bad path).
      const isErrorResult =
        result && typeof result === "object" && !Array.isArray(result) &&
        typeof result.error === "string" && Object.keys(result).length <= 2;
      logToolCall({
        name,
        args,
        success: !isErrorResult,
        error: isErrorResult ? result.error : null,
        durationMs: Date.now() - startedAt,
        conversationId: ctx.conversationId,
      });
      return result;
    }
  }
  throw new Error(`Unknown tool: ${name}`);
}
