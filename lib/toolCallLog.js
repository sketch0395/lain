// Thin adapter over the shared assistant-tools tool-call diagnostic log
// (see tools-agent/shared/tools/toolCallLog.js) — injects Lain's own
// SQLite connection into every call, same pattern as cyberNews.js/
// threatIntel.js. lib/tools/registry.js calls logToolCall() from the
// single executeTool() choke point so every tool invocation (any
// category) gets recorded without needing to opt in individually.
import { getDb } from "./db";
import toolCallLogTool from "../tools-agent/shared/tools/toolCallLog";

export function logToolCall(entry) {
  return toolCallLogTool.logToolCall(getDb(), entry);
}

export function getRecentToolCalls(opts) {
  return toolCallLogTool.getRecentCalls(getDb(), opts);
}

export function getToolFailureSummary(opts) {
  return toolCallLogTool.getFailureSummary(getDb(), opts);
}
