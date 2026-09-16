// "Core" utility tools: reminders, news, memory, and create_note. These are
// the small, cheap, frequently-used tools that stay available regardless of
// topic (see ALWAYS_INCLUDE_TOOLS in registry.js) — everything except
// create_note also works without the laptop tools agent configured at all.

import { createReminder, listReminders, cancelReminder } from "../reminders";
import { fetchTopHeadlines } from "../news";
import { addMemory } from "../memory";
import notesTool from "../../tools-agent/shared/tools/notes";
import { postToolsAgent } from "./httpClient";

export const CONFIRM_REQUIRED_TOOLS = new Set([
  "create_note",
  "create_reminder",
  "cancel_reminder",
]);

export const CATEGORY_KEYWORDS = [];

const CREATE_REMINDER_DEF = {
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
};

const LIST_REMINDERS_DEF = {
  type: "function",
  function: {
    name: "list_reminders",
    description: "List the user's currently active/upcoming reminders.",
    parameters: { type: "object", properties: {}, required: [] },
  },
};

const CANCEL_REMINDER_DEF = {
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
};

const GET_NEWS_DEF = {
  type: "function",
  function: {
    name: "get_news",
    description:
      "Fetch current top news headlines, optionally filtered by topic. " +
      "Each result includes a `link` field — always cite the source URL " +
      "alongside any headline you mention.",
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
};

const REMEMBER_FACT_DEF = {
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
};

// create_note's definition lives in the shared assistant-tools submodule
// (tools-agent/shared/tools/notes.js) so it stays in sync with other
// projects that use the same tool — see that file for the description.
const CREATE_NOTE_DEF = { type: "function", function: notesTool.toolDefinition };

/** Tool definitions in this category, gated on whether the laptop tools agent is configured (create_note needs it, the rest don't). */
export function getDefinitions({ toolsConfigured }) {
  const defs = [
    CREATE_REMINDER_DEF,
    LIST_REMINDERS_DEF,
    CANCEL_REMINDER_DEF,
    GET_NEWS_DEF,
    REMEMBER_FACT_DEF,
  ];
  if (toolsConfigured) defs.push(CREATE_NOTE_DEF);
  return defs;
}

export function describe(name, args) {
  switch (name) {
    case "create_note": {
      const mode = args.mode || "create";
      if (mode === "append") return `add to your note "${args.title}"`;
      if (mode === "replace") return `replace your note "${args.title}"`;
      return `create a note titled "${args.title}" in your Documents folder`;
    }
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
      return undefined;
  }
}

export async function execute(name, args, ctx) {
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
    case "create_note":
      return postToolsAgent("/note", {
        title: args.title,
        content: args.content,
        mode: args.mode,
      });
    default:
      return undefined;
  }
}

export const NAMES = new Set([
  "create_reminder",
  "list_reminders",
  "cancel_reminder",
  "get_news",
  "remember_fact",
  "create_note",
]);
