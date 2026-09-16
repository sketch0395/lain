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

const CATEGORIES = [core, network, forensics, omarchy, cyberIntel, systemUpdate];

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
// used utility tools regardless of topic. If nothing matches (or the
// message doesn't clearly point anywhere), fall back to sending every
// tool, so nothing ever becomes silently unreachable.

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
  "send_email",
]);

// name -> category, built from each module's NAMES set (core tools are
// omitted since they're always-include and never filtered out).
const TOOL_CATEGORIES = {};
const CATEGORY_NAME_BY_MODULE = new Map([
  [network, "network"],
  [forensics, "forensics"],
  [omarchy, "omarchy"],
  [cyberIntel, "cyber_intel"],
  [systemUpdate, "system_update"],
]);
for (const [mod, categoryName] of CATEGORY_NAME_BY_MODULE) {
  for (const name of mod.NAMES) TOOL_CATEGORIES[name] = [categoryName];
}

const CATEGORY_KEYWORDS = {
  forensics: forensics.CATEGORY_KEYWORDS,
  network: network.CATEGORY_KEYWORDS,
  omarchy: omarchy.CATEGORY_KEYWORDS,
  system_update: systemUpdate.CATEGORY_KEYWORDS,
  cyber_intel: cyberIntel.CATEGORY_KEYWORDS,
};

function matchedCategories(text) {
  const lower = text.toLowerCase();
  const matched = new Set();
  for (const [category, keywords] of Object.entries(CATEGORY_KEYWORDS)) {
    if (keywords.some((kw) => lower.includes(kw))) matched.add(category);
  }
  return matched;
}

/**
 * Same tool set as getToolDefinitions(), but trimmed down to only the
 * categories plausibly relevant to userText — plus the small always-on
 * utility set. Falls back to the full, unfiltered list if userText is
 * missing/blank or doesn't clearly match any category, so no tool ever
 * becomes silently unreachable.
 */
export function selectToolDefinitions(userText) {
  const defs = getToolDefinitions();
  if (!userText || !userText.trim()) return defs;

  const categories = matchedCategories(userText);
  if (categories.size === 0) return defs;

  const filtered = defs.filter((d) => {
    const name = d.function?.name;
    if (ALWAYS_INCLUDE_TOOLS.has(name)) return true;
    const cats = TOOL_CATEGORIES[name];
    return cats ? cats.some((c) => categories.has(c)) : false;
  });
  return filtered.length ? filtered : defs;
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
  for (const mod of CATEGORIES) {
    const result = await mod.execute(name, args, ctx);
    if (result !== undefined) return result;
  }
  throw new Error(`Unknown tool: ${name}`);
}
