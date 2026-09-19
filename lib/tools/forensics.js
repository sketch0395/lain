// Laptop/system forensics — files, processes, logs, packet captures. All
// dispatched via the laptop tools agent.
//
// The actual tool schemas/dispatch logic live in the shared assistant-tools
// submodule (tools-agent/shared/app-tools/forensics.js) so they stay in
// sync with other projects that use the same tools (Asuna) — this file
// just injects this app's own httpClient (LAIN_TOOLS_URL/TOKEN).
import { fetchToolsAgent, fetchToolsAgentRaw, postToolsAgent } from "./httpClient";
import sharedForensics from "../../tools-agent/shared/app-tools/forensics";

export const CONFIRM_REQUIRED_TOOLS = sharedForensics.CONFIRM_REQUIRED_TOOLS;
export const CATEGORY_KEYWORDS = sharedForensics.CATEGORY_KEYWORDS;
export const NAMES = sharedForensics.NAMES;

export function getDefinitions(flags) {
  return sharedForensics.getDefinitions(flags);
}

export function describe(name, args) {
  return sharedForensics.describe(name, args);
}

export async function execute(name, args) {
  return sharedForensics.execute(name, args, {
    fetchToolsAgent,
    fetchToolsAgentRaw,
    postToolsAgent,
  });
}
