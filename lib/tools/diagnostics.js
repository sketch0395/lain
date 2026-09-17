// "Diagnostics" tool: lets the assistant (and, through it, the user) look
// at the real recorded history of tool-call successes/failures instead of
// guessing why something didn't work. Every tool call across every other
// category gets logged centrally at the executeTool() choke point in
// registry.js — this module just exposes that log via a read-only tool.
import { getRecentToolCalls } from "../toolCallLog";
import toolCallLogTool from "../../tools-agent/shared/tools/toolCallLog";

export const CONFIRM_REQUIRED_TOOLS = new Set(); // read-only, executes immediately
export const CATEGORY_KEYWORDS = []; // always-included (see ALWAYS_INCLUDE_TOOLS in registry.js), no keyword gating needed

const DIAGNOSE_TOOL_CALLS_DEF = {
  type: "function",
  function: toolCallLogTool.toolDefinitions.diagnose_tool_calls,
};

export function getDefinitions() {
  return [DIAGNOSE_TOOL_CALLS_DEF];
}

export function describe(name, args) {
  return toolCallLogTool.describeToolCall(name, args);
}

export function execute(name, args) {
  if (name !== "diagnose_tool_calls") return undefined;
  const hours = Number(args.hours) > 0 ? Number(args.hours) : 24;
  const sinceMs = Date.now() - hours * 60 * 60 * 1000;
  const onlyFailures = args.only_failures !== false;
  const limit = Number(args.limit) > 0 ? Number(args.limit) : 20;
  const calls = getRecentToolCalls({
    toolName: args.tool_name || undefined,
    sinceMs,
    onlyFailures,
    limit,
  });
  return {
    window_hours: hours,
    only_failures: onlyFailures,
    count: calls.length,
    calls,
    message: calls.length
      ? undefined
      : onlyFailures
      ? `No failed tool calls recorded in the last ${hours} hour(s)${
          args.tool_name ? ` for "${args.tool_name}"` : ""
        }.`
      : `No tool calls recorded in the last ${hours} hour(s)${
          args.tool_name ? ` for "${args.tool_name}"` : ""
        }.`,
  };
}

export const NAMES = new Set(["diagnose_tool_calls"]);
