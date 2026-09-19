// "Diagnostics" tool: lets the assistant (and, through it, the user) look
// at the real recorded history of tool-call successes/failures instead of
// guessing why something didn't work. Every tool call across every other
// category gets logged centrally at the executeTool() choke point in
// registry.js — this module just exposes that log via a read-only tool.
//
// The actual tool schema/dispatch logic live in the shared assistant-tools
// submodule (tools-agent/shared/app-tools/diagnostics.js) so they stay in
// sync with other projects that use the same tools (Asuna) — this file
// just injects this app's own getRecentToolCalls (which itself wraps
// getDb() + the truly-shared toolCallLog.js).
import { getRecentToolCalls } from "../toolCallLog";
import sharedDiagnostics from "../../tools-agent/shared/app-tools/diagnostics";

export const CONFIRM_REQUIRED_TOOLS = sharedDiagnostics.CONFIRM_REQUIRED_TOOLS;
export const CATEGORY_KEYWORDS = sharedDiagnostics.CATEGORY_KEYWORDS;
export const NAMES = sharedDiagnostics.NAMES;

export function getDefinitions() {
  return sharedDiagnostics.getDefinitions();
}

export function describe(name, args) {
  return sharedDiagnostics.describe(name, args);
}

export function execute(name, args) {
  return sharedDiagnostics.execute(name, args, { getRecentToolCalls });
}
