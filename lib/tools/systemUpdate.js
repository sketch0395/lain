// Self-update / version checks. check_for_updates is a plain outbound call
// to GitHub's public API (no laptop agent needed); update_lain needs the
// laptop tools agent to actually pull/rebuild/restart.

import { checkForUpdates } from "../version";
import { postToolsAgent } from "./httpClient";

export const CONFIRM_REQUIRED_TOOLS = new Set(["update_lain"]);

export const CATEGORY_KEYWORDS = [
  "update yourself", "check for updates", "new version", "upgrade you",
  "pull latest", "redeploy", "git pull", "update lain", "update asuna",
];

const CHECK_FOR_UPDATES_DEF = {
  type: "function",
  function: {
    name: "check_for_updates",
    description:
      "Check whether a newer version of Lain is available (compares the " +
      "running build against the public GitHub repo). Read-only — " +
      "doesn't change anything.",
    parameters: { type: "object", properties: {}, required: [] },
  },
};

const UPDATE_LAIN_DEF = {
  type: "function",
  function: {
    name: "update_lain",
    description:
      "Pull the latest Lain changes and rebuild/restart Lain (and the " +
      "tools agent, if it changed) on the user's machine. This will " +
      "briefly interrupt the current session while the container " +
      "restarts — only call this after the user has confirmed they want " +
      "to update now, ideally after check_for_updates showed there's " +
      "something to pull.",
    parameters: { type: "object", properties: {}, required: [] },
  },
};

/** Tool definitions in this category — check_for_updates always available, update_lain needs the laptop tools agent. */
export function getDefinitions({ toolsConfigured }) {
  const defs = [CHECK_FOR_UPDATES_DEF];
  if (toolsConfigured) defs.push(UPDATE_LAIN_DEF);
  return defs;
}

export function describe(name) {
  switch (name) {
    case "check_for_updates":
      return "check the git repo for Lain updates";
    case "update_lain":
      return "pull the latest changes and rebuild/restart Lain (will briefly interrupt this session)";
    default:
      return undefined;
  }
}

export async function execute(name) {
  switch (name) {
    case "check_for_updates":
      return checkForUpdates();
    case "update_lain":
      return postToolsAgent("/update", {}, { timeoutMs: 15000 });
    default:
      return undefined;
  }
}

export const NAMES = new Set(["check_for_updates", "update_lain"]);
