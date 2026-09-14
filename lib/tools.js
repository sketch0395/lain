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
//
// See ../TOOLS.md for a full reference table of every tool defined here
// (name, params, implementation, and — for laptop tools — which
// tools-agent/lib/*.js module + HTTP endpoint it calls). Keep that file
// in sync when adding/changing a tool.

import { createReminder, listReminders, cancelReminder } from "./reminders";
import { fetchTopHeadlines } from "./news";
import { addMemory } from "./memory";
import { searchThreatIntel } from "./threatIntel";
import { checkForUpdates } from "./version";
import notesTool from "../tools-agent/shared/tools/notes";
import filesTool from "../tools-agent/shared/tools/files";

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
  // find_files/search_files/read_file/list_directory/summarize_directory
  // definitions live in the shared assistant-tools submodule
  // (tools-agent/shared/tools/files.js) so they stay in sync with other
  // projects that use the same tools — see that file for descriptions.
  ...Object.values(filesTool.toolDefinitions).map((fn) => ({
    type: "function",
    function: fn,
  })),
  {
    type: "function",
    function: {
      name: "hash_file",
      description:
        "Compute cryptographic hashes (MD5/SHA1/SHA256) of a file on the user's " +
        "laptop — for integrity verification, identifying known files, or comparing " +
        "against a hash database.",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string", description: "Path to the file to hash." },
          algorithms: {
            type: "string",
            description:
              "Comma-separated algorithms to compute (default 'md5,sha1,sha256'). " +
              "Any Node.js crypto digest name works, e.g. 'sha512'.",
          },
        },
        required: ["path"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "file_metadata",
      description:
        "Get forensic metadata for a file on the user's laptop: size, " +
        "created/modified/accessed/metadata-changed timestamps, permissions, MIME " +
        "type, and (for images) EXIF data if available.",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string", description: "Path to the file to inspect." },
        },
        required: ["path"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "extract_strings",
      description:
        "Extract printable text strings from a binary or unknown file on the user's " +
        "laptop (like the Unix 'strings' command) — useful for spotting URLs, " +
        "commands, credentials, or other readable artifacts embedded in a binary.",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string", description: "Path to the file to scan." },
          min_length: {
            type: "number",
            description: "Minimum string length to report (default 4).",
          },
          limit: {
            type: "number",
            description: "Max strings to return (default 200, max 2000).",
          },
        },
        required: ["path"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "list_processes",
      description:
        "List running processes on the user's laptop (pid, user, CPU%, memory%, " +
        "elapsed time, command) — sorted by CPU or memory usage.",
      parameters: {
        type: "object",
        properties: {
          limit: { type: "number", description: "Max processes to return (default 20)." },
          sort_by: {
            type: "string",
            enum: ["cpu", "mem"],
            description: "Sort by CPU or memory usage (default 'cpu').",
          },
        },
        required: [],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "network_connections",
      description:
        "List active/listening network connections on the user's laptop (protocol, " +
        "local/remote address, state, owning process) — useful for spotting " +
        "unexpected outbound connections or open ports.",
      parameters: {
        type: "object",
        properties: {
          limit: { type: "number", description: "Max connections to return (default 50)." },
        },
        required: [],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "search_logs",
      description:
        "Search the user's laptop system logs (journalctl) for a pattern, optionally " +
        "since a given time — useful for investigating suspicious activity, errors, " +
        "or a timeline of events.",
      parameters: {
        type: "object",
        properties: {
          query: {
            type: "string",
            description: "Text/regex pattern to search log messages for (optional).",
          },
          since: {
            type: "string",
            description:
              "How far back to search, in journalctl --since format, e.g. " +
              "'2026-09-12 00:00:00', '1 hour ago', 'yesterday'.",
          },
          limit: { type: "number", description: "Max log lines to return (default 50)." },
        },
        required: [],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "recent_file_activity",
      description:
        "Find files modified within the last N hours under a directory on the " +
        "user's laptop — useful for building a timeline of recent activity (e.g. " +
        "'what changed in the last day?').",
      parameters: {
        type: "object",
        properties: {
          root: {
            type: "string",
            description: "Directory to scan (defaults to the user's home directory).",
          },
          since_hours: {
            type: "number",
            description: "How many hours back to look (default 24).",
          },
          limit: { type: "number", description: "Max files to return (default 50)." },
        },
        required: [],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "login_history",
      description:
        "Show recent login history and who is currently logged into the user's " +
        "laptop — useful for spotting unexpected access.",
      parameters: {
        type: "object",
        properties: {
          limit: { type: "number", description: "Max login records to return (default 20)." },
        },
        required: [],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "analyze_pcap",
      description:
        "Analyze a network packet capture file (.pcap/.pcapng/.cap) on the user's " +
        "laptop: samples up to `limit` packets and reports protocol counts, top " +
        "talkers (most active hosts), and a sample of the raw packet lines. This " +
        "is a sample-based summary, not a full-file analysis, for large captures.",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string", description: "Path to the pcap file." },
          limit: {
            type: "number",
            description: "Max packets to sample (default 500, max 5000).",
          },
        },
        required: ["path"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "capture_packets",
      description:
        "Capture live network traffic on the user's laptop and report protocol " +
        "counts, top talkers, and sample packet lines — e.g. 'capture some " +
        "traffic and tell me what's talking to the internet right now' or " +
        "'run a pcap for 5 minutes'. Captures up to ~25s run immediately and " +
        "you get the summary right away. Longer captures (minutes, up to 30) " +
        "run in the background instead — you'll get an immediate 'started' " +
        "acknowledgement to tell the user, and a desktop notification is sent " +
        "automatically when it finishes (you don't need to do anything else " +
        "or call analyze_pcap yourself; the user will be notified). The " +
        "capture is always saved as a .pcap file (to ~/Documents/pcaps/ by " +
        "default, or save_path if given) so it's never lost — pass " +
        "no_save: true only if the user explicitly doesn't want it kept. " +
        "Requires the tools agent's tcpdump to have packet-capture " +
        "permissions (setup-tools-agent.sh grants this); if not, it'll return a " +
        "clear error explaining how to fix that. Only call this when the user " +
        "actually wants a live capture — use analyze_pcap instead for an " +
        "existing .pcap file.",
      parameters: {
        type: "object",
        properties: {
          duration: {
            type: "number",
            description:
              "How many seconds to capture for (default 10, max 1800 = 30 " +
              "minutes). Convert minutes to seconds, e.g. '5 minutes' -> 300. " +
              "Anything over ~25s automatically runs in the background.",
          },
          limit: {
            type: "number",
            description:
              "Stop early once this many packets are captured (default 100 " +
              "for short captures, higher automatically for background ones, " +
              "max 1,000,000).",
          },
          interface: {
            type: "string",
            description:
              "Network interface to capture on, e.g. 'eth0', 'wlan0' (default 'any', " +
              "meaning all interfaces).",
          },
          filter: {
            type: "string",
            description:
              "Optional BPF filter to narrow the capture, e.g. 'tcp port 443', " +
              "'host 8.8.8.8', 'udp'.",
          },
          save_path: {
            type: "string",
            description:
              "Where to save the raw capture as a .pcap file for later analysis " +
              "(e.g. with analyze_pcap), within directories the user has allowed. " +
              "Defaults to a timestamped file under ~/Documents/pcaps/ if not " +
              "given — the capture is saved either way. Any missing folders in " +
              "the path are created automatically, e.g. " +
              "'~/Documents/pcaps/capture1.pcap' creates the pcaps folder if it " +
              "doesn't exist yet. '.pcap' is appended if the name doesn't already " +
              "end in a recognized pcap extension.",
          },
          no_save: {
            type: "boolean",
            description:
              "Set true to skip saving entirely and only get the in-memory " +
              "summary — only do this if the user explicitly says not to save it.",
          },
        },
        required: [],
      },
    },
  },
  // create_note's definition lives in the shared assistant-tools submodule
  // (tools-agent/shared/tools/notes.js) so it stays in sync with other
  // projects that use the same tool — see that file for the description.
  { type: "function", function: notesTool.toolDefinition },
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
  {
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
  },
];

// Reminder/news/update-check tools — always available (don't need the
// laptop tools agent; check_for_updates is a plain outbound call to
// GitHub's public API, see lib/version.js).
export const REMINDER_TOOL_DEFINITIONS = [
  {
    type: "function",
    function: {
      name: "check_for_updates",
      description:
        "Check whether a newer version of Lain is available (compares the " +
        "running build against the public GitHub repo). Read-only — " +
        "doesn't change anything.",
      parameters: { type: "object", properties: {}, required: [] },
    },
  },
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
  {
    type: "function",
    function: {
      name: "lookup_threat_intel",
      description:
        "Search Lain's curated cyber threat intelligence reference library — " +
        "cyber kill chain phases, attack techniques/tactics, IOCs, " +
        "mitigations, and other security reference material the user has " +
        "added. Use this whenever discussing an attack, incident, malware " +
        "behavior, or asked to map something to the kill chain/a framework, " +
        "so you can cite real curated reference content instead of relying " +
        "only on your own general knowledge. Returns the best-matching " +
        "entries (category, title, content) — synthesize an answer from " +
        "them in your own words, don't just dump them raw.",
      parameters: {
        type: "object",
        properties: {
          query: {
            type: "string",
            description:
              "What to search for, e.g. 'reconnaissance', 'lateral movement', " +
              "'command and control', a technique name, or a keyword.",
          },
          limit: {
            type: "number",
            description: "Max entries to return (default 8).",
          },
        },
        required: ["query"],
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
  ...filesTool.CONFIRM_REQUIRED_TOOLS,
  "hash_file",
  "file_metadata",
  "extract_strings",
  "list_processes",
  "network_connections",
  "search_logs",
  "recent_file_activity",
  "login_history",
  "analyze_pcap",
  "capture_packets",
  "create_note",
  "omarchy_status",
  "list_omarchy_themes",
  "set_omarchy_theme",
  "update_lain",
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
  const shared = filesTool.describeToolCall(name, args);
  if (shared) return shared;
  switch (name) {
    case "system_diagnostics":
      return "check your laptop's system diagnostics (CPU, memory, disk, uptime)";
    case "hash_file":
      return `compute hashes for ${args.path}`;
    case "file_metadata":
      return `check metadata for ${args.path}`;
    case "extract_strings":
      return `extract text strings from ${args.path}`;
    case "list_processes":
      return `list running processes${args.sort_by ? ` (sorted by ${args.sort_by})` : ""}`;
    case "network_connections":
      return "list active network connections";
    case "search_logs":
      return args.query
        ? `search system logs for "${args.query}"${args.since ? ` since ${args.since}` : ""}`
        : `check recent system logs${args.since ? ` since ${args.since}` : ""}`;
    case "recent_file_activity":
      return `find files modified in the last ${args.since_hours || 24}h${
        args.root ? ` under ${args.root}` : ""
      }`;
    case "login_history":
      return "check login history and who's currently logged in";
    case "analyze_pcap":
      return `analyze the packet capture ${args.path}`;
    case "capture_packets":
      return `capture live network traffic for ${args.duration || 10}s${
        args.filter ? ` (filter: ${args.filter})` : ""
      }`;
    case "create_note": {
      const mode = args.mode || "create";
      if (mode === "append") return `add to your note "${args.title}"`;
      if (mode === "replace") return `replace your note "${args.title}"`;
      return `create a note titled "${args.title}" in your Documents folder`;
    }
    case "omarchy_status":
      return "check your Omarchy desktop status (theme, active window, workspace)";
    case "list_omarchy_themes":
      return "list your installed Omarchy themes";
    case "set_omarchy_theme":
      return `switch your Omarchy theme to "${args.theme}"`;
    case "check_for_updates":
      return "check the git repo for Lain updates";
    case "update_lain":
      return "pull the latest changes and rebuild/restart Lain (will briefly interrupt this session)";
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
    case "lookup_threat_intel":
      return `look up threat intel on "${args.query}"`;
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
    case "lookup_threat_intel":
      return { results: searchThreatIntel(args.query, args.limit) };
    case "check_for_updates":
      return checkForUpdates();
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

  // find_files/search_files/read_file/list_directory/summarize_directory
  // are dispatched via the shared assistant-tools module so their request
  // shape can't drift from the tool definitions above.
  const sharedReq = filesTool.buildRequest(name, args);
  if (sharedReq) {
    url = `${TOOLS_URL}${sharedReq.path}?${sharedReq.searchParams}`;
  } else {
  switch (name) {
    case "system_diagnostics":
      url = `${TOOLS_URL}/diagnostics`;
      break;
    case "hash_file": {
      const params = new URLSearchParams({ path: args.path || "" });
      if (args.algorithms) params.set("algorithms", args.algorithms);
      url = `${TOOLS_URL}/hash?${params}`;
      break;
    }
    case "file_metadata": {
      const params = new URLSearchParams({ path: args.path || "" });
      url = `${TOOLS_URL}/metadata?${params}`;
      break;
    }
    case "extract_strings": {
      const params = new URLSearchParams({ path: args.path || "" });
      if (args.min_length) params.set("minLength", String(args.min_length));
      if (args.limit) params.set("limit", String(args.limit));
      url = `${TOOLS_URL}/strings?${params}`;
      break;
    }
    case "list_processes": {
      const params = new URLSearchParams();
      if (args.limit) params.set("limit", String(args.limit));
      if (args.sort_by) params.set("sortBy", args.sort_by);
      url = `${TOOLS_URL}/processes?${params}`;
      break;
    }
    case "network_connections": {
      const params = new URLSearchParams();
      if (args.limit) params.set("limit", String(args.limit));
      url = `${TOOLS_URL}/connections?${params}`;
      break;
    }
    case "search_logs": {
      const params = new URLSearchParams();
      if (args.query) params.set("q", args.query);
      if (args.since) params.set("since", args.since);
      if (args.limit) params.set("limit", String(args.limit));
      url = `${TOOLS_URL}/logs?${params}`;
      break;
    }
    case "recent_file_activity": {
      const params = new URLSearchParams();
      if (args.root) params.set("root", args.root);
      if (args.since_hours) params.set("sinceHours", String(args.since_hours));
      if (args.limit) params.set("limit", String(args.limit));
      url = `${TOOLS_URL}/recent-activity?${params}`;
      break;
    }
    case "login_history": {
      const params = new URLSearchParams();
      if (args.limit) params.set("limit", String(args.limit));
      url = `${TOOLS_URL}/login-history?${params}`;
      break;
    }
    case "analyze_pcap": {
      const params = new URLSearchParams({ path: args.path || "" });
      if (args.limit) params.set("limit", String(args.limit));
      url = `${TOOLS_URL}/pcap?${params}`;
      break;
    }
    case "capture_packets": {
      // The agent itself decides sync vs. background based on duration
      // (anything over ~25s responds immediately with a "started"
      // acknowledgement instead of blocking) — so this client-side wait
      // only ever needs to cover a short synchronous capture, never the
      // full requested duration.
      const CAPTURE_SYNC_MAX_SECONDS = 25;
      const durationMs =
        Math.min(Math.max(Number(args.duration) || 10, 1), CAPTURE_SYNC_MAX_SECONDS) * 1000;
      const res = await fetch(`${TOOLS_URL}/capture`, {
        method: "POST",
        headers: { ...headers, "Content-Type": "application/json" },
        body: JSON.stringify({
          duration: args.duration,
          limit: args.limit,
          interface: args.interface,
          filter: args.filter,
          savePath: args.no_save ? false : args.save_path,
        }),
        signal: AbortSignal.timeout(durationMs + 30000),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(body.error || `Tools agent responded with ${res.status}`);
      }
      return body;
    }
    case "create_note": {
      const res = await fetch(`${TOOLS_URL}/note`, {
        method: "POST",
        headers: { ...headers, "Content-Type": "application/json" },
        body: JSON.stringify({ title: args.title, content: args.content, mode: args.mode }),
        signal: AbortSignal.timeout(10000),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(body.error || `Tools agent responded with ${res.status}`);
      }
      return body;
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
    case "update_lain": {
      const res = await fetch(`${TOOLS_URL}/update`, {
        method: "POST",
        headers,
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
  }

  // Hashing/pcap/strings can take a while on large files — give them more
  // room than the default 10s budget used by quick lookups.
  const SLOW_TOOLS = new Set(["hash_file", "analyze_pcap", "extract_strings"]);
  const timeoutMs = SLOW_TOOLS.has(name) ? 120000 : 10000;

  const res = await fetch(url, {
    headers,
    signal: AbortSignal.timeout(timeoutMs),
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
