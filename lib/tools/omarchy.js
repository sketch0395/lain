// Omarchy desktop control (themes, commands, backgrounds) — all dispatched
// via the laptop tools agent.
//
// The actual tool schemas/dispatch logic live in the shared assistant-tools
// submodule (tools-agent/shared/app-tools/omarchy.js) so they stay in sync
// with other projects that use the same tools (Asuna) — this file just
// injects this app's own httpClient (LAIN_TOOLS_URL/TOKEN).
import { fetchToolsAgent, postToolsAgent } from "./httpClient";
import sharedOmarchy from "../../tools-agent/shared/app-tools/omarchy";

export const CONFIRM_REQUIRED_TOOLS = sharedOmarchy.CONFIRM_REQUIRED_TOOLS;
export const CATEGORY_KEYWORDS = sharedOmarchy.CATEGORY_KEYWORDS;
export const NAMES = sharedOmarchy.NAMES;

export function getDefinitions(flags) {
  return sharedOmarchy.getDefinitions(flags);
}

export function describe(name, args) {
  return sharedOmarchy.describe(name, args);
}

export async function execute(name, args) {
  return sharedOmarchy.execute(name, args, { fetchToolsAgent, postToolsAgent });
}
