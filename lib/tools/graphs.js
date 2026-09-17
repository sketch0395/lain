// "Graphs" tool category: lets the assistant actually draw a diagram of its
// own real, live data — remembered facts, upcoming reminders/automations,
// and recent tool-call history — instead of only describing them in text.
// Each tool below builds a Mermaid diagram string server-side from real
// rows (never invented data) and returns it inside a fenced ```mermaid
// code block; the model is instructed (see DIAGRAM_PROMPT_ADDENDUM in
// app/api/chat/route.js) to include that block verbatim in its reply, and
// MarkdownMessage.js/MermaidDiagram.js render it as an actual diagram
// client-side.
import { listMemories } from "../memory";
import { listReminders } from "../reminders";
import { getRecentToolCalls } from "../toolCallLog";

export const CONFIRM_REQUIRED_TOOLS = new Set(); // read-only, executes immediately
export const CATEGORY_KEYWORDS = [
  "diagram",
  "visualize",
  "visualise",
  "graph",
  "workflow",
  "flowchart",
  "chart",
  "draw",
  "mermaid",
  "map out",
  "picture",
];

// Mermaid node/edge labels break on unescaped quotes/brackets/newlines —
// keep labels short and safe rather than trusting arbitrary user content.
function mermaidLabel(text, maxLen = 60) {
  const clean = String(text || "")
    .replace(/[\r\n]+/g, " ")
    .replace(/"/g, "'")
    .trim();
  return clean.length > maxLen ? `${clean.slice(0, maxLen - 1)}…` : clean;
}

const VISUALIZE_MEMORY_GRAPH_DEF = {
  type: "function",
  function: {
    name: "visualize_memory_graph",
    description:
      "Builds a Mermaid flowchart diagram of facts remembered about the user (from remember_fact), " +
      "as a hub-and-spoke graph centered on 'You'. Returns the diagram as a fenced mermaid code block " +
      "to include verbatim in your reply — don't just describe it in prose.",
    parameters: {
      type: "object",
      properties: {
        limit: {
          type: "integer",
          description: "Max number of facts to include (most recent first). Default 20.",
        },
      },
    },
  },
};

const VISUALIZE_REMINDERS_DEF = {
  type: "function",
  function: {
    name: "visualize_reminders",
    description:
      "Builds a Mermaid flowchart of currently active reminders/automations, ordered by next run time, " +
      "showing what's scheduled next. Returns the diagram as a fenced mermaid code block to include " +
      "verbatim in your reply.",
    parameters: { type: "object", properties: {} },
  },
};

const VISUALIZE_TOOL_CALLS_DEF = {
  type: "function",
  function: {
    name: "visualize_tool_calls",
    description:
      "Builds a Mermaid flowchart of recent tool-call history in chronological order, color-coded " +
      "green (success) / red (failure), so the user can see the actual sequence of what ran and what " +
      "broke. Returns the diagram as a fenced mermaid code block to include verbatim in your reply.",
    parameters: {
      type: "object",
      properties: {
        hours: { type: "integer", description: "Look-back window in hours. Default 24." },
        limit: { type: "integer", description: "Max number of calls to include. Default 15." },
      },
    },
  },
};

export function getDefinitions() {
  return [VISUALIZE_MEMORY_GRAPH_DEF, VISUALIZE_REMINDERS_DEF, VISUALIZE_TOOL_CALLS_DEF];
}

export function describe(name) {
  if (name === "visualize_memory_graph") return "draw a diagram of what's been remembered about you";
  if (name === "visualize_reminders") return "draw a diagram of your active reminders/automations";
  if (name === "visualize_tool_calls") return "draw a diagram of recent tool-call history";
  return null;
}

function buildMemoryGraph(limit) {
  const memories = listMemories().slice(0, limit);
  if (memories.length === 0) {
    return { mermaid: null, message: "Nothing remembered yet — nothing to diagram." };
  }
  const lines = ["flowchart TD", '  You(("You"))'];
  memories.forEach((m, i) => {
    const nodeId = `F${i}`;
    lines.push(`  You --> ${nodeId}["${mermaidLabel(m.content)}"]`);
  });
  return { mermaid: lines.join("\n"), count: memories.length };
}

function buildReminderGraph() {
  const reminders = listReminders();
  if (reminders.length === 0) {
    return { mermaid: null, message: "No active reminders — nothing to diagram." };
  }
  const lines = ["flowchart LR"];
  reminders.forEach((r, i) => {
    const nodeId = `R${i}`;
    const when = new Date(r.next_run).toLocaleString();
    const label = mermaidLabel(`${r.title}\\n${when}`, 80);
    lines.push(`  ${nodeId}["${label}"]`);
    if (i > 0) lines.push(`  R${i - 1} --> ${nodeId}`);
  });
  return { mermaid: lines.join("\n"), count: reminders.length };
}

function buildToolCallGraph(hours, limit) {
  const sinceMs = Date.now() - hours * 60 * 60 * 1000;
  const calls = getRecentToolCalls({ sinceMs, onlyFailures: false, limit });
  if (calls.length === 0) {
    return { mermaid: null, message: `No tool calls recorded in the last ${hours} hour(s).` };
  }
  // getRecentToolCalls returns most-recent-first; reverse for a
  // left-to-right chronological flow.
  const chronological = [...calls].reverse();
  const lines = [
    "flowchart LR",
    "  classDef ok fill:#2ecc71,color:#022,stroke:#1e8449;",
    "  classDef fail fill:#e74c3c,color:#fff,stroke:#922b21;",
  ];
  chronological.forEach((c, i) => {
    const nodeId = `C${i}`;
    const mark = c.success ? "✓" : "✗";
    const detail = c.success ? `${c.duration_ms ?? "?"}ms` : mermaidLabel(c.error || "failed", 40);
    const label = mermaidLabel(`${c.name}\\n${mark} ${detail}`, 80);
    lines.push(`  ${nodeId}["${label}"]:::${c.success ? "ok" : "fail"}`);
    if (i > 0) lines.push(`  C${i - 1} --> ${nodeId}`);
  });
  return { mermaid: lines.join("\n"), count: chronological.length };
}

export function execute(name, args) {
  if (name === "visualize_memory_graph") {
    const limit = Number(args.limit) > 0 ? Number(args.limit) : 20;
    const { mermaid, message, count } = buildMemoryGraph(limit);
    if (!mermaid) return { message };
    return { count, mermaid_diagram: `\`\`\`mermaid\n${mermaid}\n\`\`\`` };
  }
  if (name === "visualize_reminders") {
    const { mermaid, message, count } = buildReminderGraph();
    if (!mermaid) return { message };
    return { count, mermaid_diagram: `\`\`\`mermaid\n${mermaid}\n\`\`\`` };
  }
  if (name === "visualize_tool_calls") {
    const hours = Number(args.hours) > 0 ? Number(args.hours) : 24;
    const limit = Number(args.limit) > 0 ? Number(args.limit) : 15;
    const { mermaid, message, count } = buildToolCallGraph(hours, limit);
    if (!mermaid) return { message };
    return { count, window_hours: hours, mermaid_diagram: `\`\`\`mermaid\n${mermaid}\n\`\`\`` };
  }
  return undefined;
}

export const NAMES = new Set([
  "visualize_memory_graph",
  "visualize_reminders",
  "visualize_tool_calls",
]);
