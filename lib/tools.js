// Client for the `lain-tools-agent` running on the user's laptop — a small,
// read-only, token-authenticated HTTP service that lets Lain check system
// diagnostics and look at files, strictly within directories the user
// allowed. See tools-agent/server.js for the implementation and
// scripts/setup-tools-agent.sh for installation.
//
// This module also defines Lain's reminder/news tools. Those run entirely
// server-side (lib/reminders.js, lib/news.js) and don't need the laptop
// agent at all — only the "desktop notification" delivery channel for a
// fired reminder (see lib/notify.js) touches the laptop agent.

import { createReminder, listReminders, cancelReminder } from "./reminders";
import { fetchTopHeadlines } from "./news";
import { addMemory } from "./memory";

const TOOLS_URL = process.env.LAIN_TOOLS_URL || "";
const TOOLS_TOKEN = process.env.LAIN_TOOLS_TOKEN || "";

export function toolsConfigured() {
  return Boolean(TOOLS_URL && TOOLS_TOKEN);
}

// Ollama-compatible tool/function definitions for the laptop tools agent —
// only offered to the model when LAIN_TOOLS_URL/LAIN_TOOLS_TOKEN are set.
export const LAPTOP_TOOL_DEFINITIONS = [
  {
    type: "function",
    function: {
      name: "system_diagnostics",
      description:
        "Get diagnostics for the user's laptop: CPU load, memory usage, disk usage, uptime, hostname.",
      parameters: { type: "object", properties: {}, required: [] },
    },
  },
  {
    type: "function",
    function: {
      name: "find_files",
      description:
        "Find files on the user's laptop by (partial) file name, within directories the user has allowed.",
      parameters: {
        type: "object",
        properties: {
          query: {
            type: "string",
            description: "Substring to match against file names.",
          },
          root: {
            type: "string",
            description:
              "Optional directory to search under (defaults to the user's home directory).",
          },
          limit: {
            type: "number",
            description: "Max results to return (default 30).",
          },
        },
        required: ["query"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "search_files",
      description:
        "Search file contents for a substring on the user's laptop, within directories the user has allowed.",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: "Text to search for inside files." },
          root: { type: "string", description: "Optional directory to search under." },
          limit: { type: "number", description: "Max matches to return (default 20)." },
        },
        required: ["query"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "read_file",
      description:
        "Read the contents of a specific text file on the user's laptop (truncated if large).",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string", description: "Absolute path to the file." },
          max_bytes: {
            type: "number",
            description: "Max bytes to read (default 20000).",
          },
        },
        required: ["path"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "omarchy_status",
      description:
        "Get the user's Omarchy desktop status: current theme, active window, " +
        "active workspace, and connected monitors.",
      parameters: { type: "object", properties: {}, required: [] },
    },
  },
  {
    type: "function",
    function: {
      name: "list_omarchy_themes",
      description: "List the Omarchy themes currently installed on the user's laptop.",
      parameters: { type: "object", properties: {}, required: [] },
    },
  },
  {
    type: "function",
    function: {
      name: "set_omarchy_theme",
      description:
        "Switch the user's Omarchy desktop to a different installed theme (changes " +
        "colors, background, terminal/app theming system-wide). Use list_omarchy_themes " +
        "first if unsure of the exact theme name.",
      parameters: {
        type: "object",
        properties: {
          theme: {
            type: "string",
            description: "Exact theme name, e.g. 'Tokyo Night' or 'Gundam Barbatos'.",
          },
        },
        required: ["theme"],
      },
    },
  },
];

// Reminder/news tools — always available (don't need the laptop agent).
export const REMINDER_TOOL_DEFINITIONS = [
  {
    type: "function",
    function: {
      name: "create_reminder",
      description:
        "Create a one-time or recurring reminder. Lain will notify the user " +
        "(desktop + browser push) when it's due. Always compute run_at as an " +
        "absolute local date-time based on the current date/time given in the " +
        "system prompt and the user's relative request (e.g. 'in 30 minutes', " +
        "'tomorrow at 9am', 'every weekday at 9am'). For schedules that don't " +
        "fit once/daily/weekly/weekdays (e.g. 'every 2 hours', 'the 1st of " +
        "every month', 'every Mon/Wed/Fri at 6pm'), set repeat to 'cron' and " +
        "provide a standard 5-field cron_expr (minute hour day month weekday) " +
        "instead of run_at.",
      parameters: {
        type: "object",
        properties: {
          title: { type: "string", description: "Short label, e.g. 'Timesheet'." },
          message: {
            type: "string",
            description:
              "What to say to the user when this reminder fires. For 'digest' " +
              "reminders this is optional and treated as a focus/note (e.g. " +
              "'focus on work stuff') rather than a fixed message.",
          },
          action: {
            type: "string",
            enum: ["notify", "news", "digest"],
            description:
              "'notify' = plain reminder message (default). 'news' = also fetch " +
              "and include current top headlines. 'digest' = a proactive " +
              "briefing generated fresh each time it fires, using upcoming " +
              "reminders, things learned about the user, and news — good for " +
              "'give me a daily briefing' / 'check in on me every morning' " +
              "style requests.",
          },
          repeat: {
            type: "string",
            enum: ["once", "daily", "weekly", "weekdays", "cron"],
            description:
              "How often it repeats. Default 'once'. Use 'cron' for a custom " +
              "schedule via cron_expr.",
          },
          run_at: {
            type: "string",
            description:
              "Absolute local date-time of the first/next occurrence, format " +
              "YYYY-MM-DDTHH:MM:SS. Required unless repeat is 'cron'.",
          },
          cron_expr: {
            type: "string",
            description:
              "Standard 5-field cron expression (minute hour day month weekday), " +
              "e.g. '0 9 * * 1-5' for weekdays at 9am. Required when repeat is 'cron'.",
          },
          email_to: {
            type: "string",
            description:
              "Optional email address (or comma-separated list) to send this " +
              "reminder to. If omitted, falls back to the server's default " +
              "reminder recipient, if configured.",
          },
        },
        required: ["title", "repeat"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "list_reminders",
      description: "List the user's currently active/upcoming reminders.",
      parameters: { type: "object", properties: {}, required: [] },
    },
  },
  {
    type: "function",
    function: {
      name: "cancel_reminder",
      description: "Cancel an existing reminder by its id or (partial) title.",
      parameters: {
        type: "object",
        properties: {
          id_or_title: {
            type: "string",
            description: "The reminder's id, or a substring of its title.",
          },
        },
        required: ["id_or_title"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_news",
      description: "Fetch current top news headlines, optionally filtered by topic.",
      parameters: {
        type: "object",
        properties: {
          topic: {
            type: "string",
            description: "Optional keyword to filter headlines by (e.g. 'tech').",
          },
        },
        required: [],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "remember_fact",
      description:
        "Save a short, durable fact about the user for future conversations — " +
        "e.g. a preference, an important date, an ongoing project, a habit, " +
        "something they care about. Only call this for things worth " +
        "remembering long-term, not small talk or one-off details. Keep the " +
        "fact concise and self-contained (it will be shown to you verbatim " +
        "in later conversations).",
      parameters: {
        type: "object",
        properties: {
          fact: {
            type: "string",
            description: "The fact to remember, written concisely in third person.",
          },
        },
        required: ["fact"],
      },
    },
  },
];

/** All tool definitions currently available to the model. */
export function getToolDefinitions() {
  return toolsConfigured()
    ? [...LAPTOP_TOOL_DEFINITIONS, ...REMINDER_TOOL_DEFINITIONS]
    : REMINDER_TOOL_DEFINITIONS;
}

// Tools that mutate state (or the laptop tools agent's read of the user's
// filesystem) always require an explicit Allow/Deny before running.
// Read-only reminder/news lookups execute immediately.
const CONFIRM_REQUIRED_TOOLS = new Set([
  "system_diagnostics",
  "find_files",
  "search_files",
  "read_file",
  "omarchy_status",
  "list_omarchy_themes",
  "set_omarchy_theme",
  "create_reminder",
  "cancel_reminder",
]);

export function requiresConfirmation(name) {
  return CONFIRM_REQUIRED_TOOLS.has(name);
}

function parseArgs(raw) {
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
  switch (name) {
    case "system_diagnostics":
      return "check your laptop's system diagnostics (CPU, memory, disk, uptime)";
    case "find_files":
      return `find files named like "${args.query}"${
        args.root ? ` under ${args.root}` : ""
      }`;
    case "search_files":
      return `search file contents for "${args.query}"${
        args.root ? ` under ${args.root}` : ""
      }`;
    case "read_file":
      return `read the file ${args.path}`;
    case "omarchy_status":
      return "check your Omarchy desktop status (theme, active window, workspace)";
    case "list_omarchy_themes":
      return "list your installed Omarchy themes";
    case "set_omarchy_theme":
      return `switch your Omarchy theme to "${args.theme}"`;
    case "create_reminder": {
      const schedule =
        args.repeat === "cron"
          ? `custom-schedule reminder "${args.title || "Reminder"}" (cron: ${
              args.cron_expr || "?"
            })`
          : `${args.repeat || "once"} reminder "${args.title || "Reminder"}" at ${
              args.run_at || "?"
            }`;
      const base =
        args.action === "digest"
          ? `create a proactive briefing ${schedule}`
          : `create a ${schedule}`;
      return args.email_to ? `${base}, emailed to ${args.email_to}` : base;
    }
    case "list_reminders":
      return "list your active reminders";
    case "cancel_reminder":
      return `cancel the reminder "${args.id_or_title}"`;
    case "get_news":
      return args.topic ? `get news about "${args.topic}"` : "get the current top headlines";
    case "remember_fact":
      return `remember: ${args.fact}`;
    default:
      return `run ${name}`;
  }
}

/** Executes any tool call — reminder/news tools run locally, everything else hits the laptop agent. */
export async function executeTool(name, rawArgs, ctx = {}) {
  const args = parseArgs(rawArgs);
  switch (name) {
    case "create_reminder":
      return createReminder({ ...args, conversationId: ctx.conversationId });
    case "list_reminders":
      return { reminders: listReminders() };
    case "cancel_reminder":
      return cancelReminder(args.id_or_title);
    case "get_news":
      return fetchTopHeadlines(args.topic);
    case "remember_fact":
      return addMemory(args.fact, ctx.conversationId);
    default:
      return callTool(name, args);
  }
}

/** Best-effort desktop notification via the laptop tools agent (used by lib/notify.js). */
export async function notifyLaptop(title, body) {
  if (!toolsConfigured()) return false;
  try {
    const res = await fetch(`${TOOLS_URL}/notify`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${TOOLS_TOKEN}` },
      body: JSON.stringify({ title, body }),
      signal: AbortSignal.timeout(8000),
    });
    return res.ok;
  } catch {
    return false;
  }
}

/** Executes a tool call against the laptop's tools agent. */
export async function callTool(name, rawArgs) {
  if (!toolsConfigured()) {
    throw new Error(
      "Tools agent is not configured (set LAIN_TOOLS_URL/LAIN_TOOLS_TOKEN)."
    );
  }
  const args = parseArgs(rawArgs);
  const headers = { Authorization: `Bearer ${TOOLS_TOKEN}` };
  let url;

  switch (name) {
    case "system_diagnostics":
      url = `${TOOLS_URL}/diagnostics`;
      break;
    case "find_files": {
      const params = new URLSearchParams({ q: args.query || "" });
      if (args.root) params.set("root", args.root);
      if (args.limit) params.set("limit", String(args.limit));
      url = `${TOOLS_URL}/find?${params}`;
      break;
    }
    case "search_files": {
      const params = new URLSearchParams({ q: args.query || "" });
      if (args.root) params.set("root", args.root);
      if (args.limit) params.set("limit", String(args.limit));
      url = `${TOOLS_URL}/search?${params}`;
      break;
    }
    case "read_file": {
      const params = new URLSearchParams({ path: args.path || "" });
      if (args.max_bytes) params.set("max", String(args.max_bytes));
      url = `${TOOLS_URL}/read?${params}`;
      break;
    }
    case "omarchy_status":
      url = `${TOOLS_URL}/omarchy/status`;
      break;
    case "list_omarchy_themes":
      url = `${TOOLS_URL}/omarchy/themes`;
      break;
    case "set_omarchy_theme": {
      const res = await fetch(`${TOOLS_URL}/omarchy/theme`, {
        method: "POST",
        headers: { ...headers, "Content-Type": "application/json" },
        body: JSON.stringify({ theme: args.theme }),
        signal: AbortSignal.timeout(15000),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(body.error || `Tools agent responded with ${res.status}`);
      }
      return body;
    }
    default:
      throw new Error(`Unknown tool: ${name}`);
  }

  const res = await fetch(url, {
    headers,
    signal: AbortSignal.timeout(10000),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(body.error || `Tools agent responded with ${res.status}`);
  }
  return body;
}

export async function toolsReachable() {
  if (!toolsConfigured()) return false;
  try {
    const res = await fetch(`${TOOLS_URL}/health`, {
      headers: { Authorization: `Bearer ${TOOLS_TOKEN}` },
      signal: AbortSignal.timeout(5000),
    });
    return res.ok;
  } catch {
    return false;
  }
}

export { parseArgs };
