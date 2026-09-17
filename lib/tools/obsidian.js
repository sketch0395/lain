// "Obsidian" tool category: lets Lain read and write notes in the user's
// real local Obsidian vault, bind-mounted into the container read/write
// (see docker-compose.yml's OBSIDIAN_VAULT_PATH -> /vault). Reads can see
// the whole vault; writes are restricted to a dedicated subfolder
// (OBSIDIAN_WRITE_SUBFOLDER, default "Lain") so the assistant never
// touches the user's own notes outside that folder.
import fs from "fs";
import path from "path";

const VAULT_DIR = process.env.OBSIDIAN_VAULT_DIR || "/vault";
const WRITE_SUBFOLDER = process.env.OBSIDIAN_WRITE_SUBFOLDER || "Lain";

/** True only if the vault directory is actually mounted/present. */
export function obsidianConfigured() {
  try {
    return fs.statSync(VAULT_DIR).isDirectory();
  } catch {
    return false;
  }
}

function resolvedVaultDir() {
  return path.resolve(VAULT_DIR);
}

// Prevents a relative path from escaping the vault directory (e.g. "../../etc/passwd").
function safeResolve(relPath) {
  const base = resolvedVaultDir();
  const resolved = path.resolve(base, relPath || ".");
  if (resolved !== base && !resolved.startsWith(base + path.sep)) {
    throw new Error("That path is outside the vault.");
  }
  return resolved;
}

function walkMarkdownFiles(dir, base) {
  let results = [];
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return results;
  }
  for (const entry of entries) {
    // Skip dotfolders like .obsidian/.trash and any hidden files.
    if (entry.name.startsWith(".")) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results = results.concat(walkMarkdownFiles(full, base));
    } else if (entry.isFile() && entry.name.toLowerCase().endsWith(".md")) {
      results.push(path.relative(base, full));
    }
  }
  return results;
}

function snippetAround(content, query) {
  const lower = content.toLowerCase();
  const idx = lower.indexOf(query.toLowerCase());
  if (idx === -1) return content.slice(0, 200).trim();
  const start = Math.max(0, idx - 80);
  const end = Math.min(content.length, idx + query.length + 80);
  return `${start > 0 ? "…" : ""}${content.slice(start, end).trim()}${end < content.length ? "…" : ""}`;
}

function sanitizeFilename(title) {
  const clean = String(title || "Untitled")
    .replace(/[\\/:*?"<>|]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return clean.length ? clean : "Untitled";
}

const LOOKUP_DEF = {
  type: "function",
  function: {
    name: "lookup_obsidian_note",
    description:
      "Searches the user's real local Obsidian vault (their personal notes) by filename and content. " +
      "Use it whenever the user references 'my notes', 'my vault', or asks you to check/recall " +
      "something they wrote down in Obsidian. Returns matching note titles/paths with a short snippet " +
      "— follow up with read_obsidian_note on a specific path to get the full content.",
    parameters: {
      type: "object",
      properties: {
        query: { type: "string", description: "Search text to match against note titles and content." },
        limit: { type: "integer", description: "Max number of matching notes to return. Default 5." },
      },
      required: ["query"],
    },
  },
};

const READ_DEF = {
  type: "function",
  function: {
    name: "read_obsidian_note",
    description:
      "Reads the full content of one note from the user's Obsidian vault by its path (as returned by " +
      "lookup_obsidian_note).",
    parameters: {
      type: "object",
      properties: {
        path: { type: "string", description: "Relative path of the note within the vault, e.g. 'Projects/idea.md'." },
      },
      required: ["path"],
    },
  },
};

const SAVE_DEF = {
  type: "function",
  function: {
    name: "save_obsidian_note",
    description:
      "Creates or overwrites a note in a dedicated 'Lain' subfolder of the user's Obsidian vault — never " +
      "outside it. Use it whenever the user asks you to write something down, save it, or add it to " +
      "their notes/vault/Obsidian. Requires the user's confirmation before writing.",
    parameters: {
      type: "object",
      properties: {
        title: { type: "string", description: "Note title — becomes the filename." },
        content: { type: "string", description: "Full markdown content of the note." },
      },
      required: ["title", "content"],
    },
  },
};

export function getDefinitions() {
  if (!obsidianConfigured()) return [];
  return [LOOKUP_DEF, READ_DEF, SAVE_DEF];
}

export function describe(name, args) {
  if (name === "lookup_obsidian_note") return `search your Obsidian vault for "${args.query}"`;
  if (name === "read_obsidian_note") return `read the Obsidian note "${args.path}"`;
  if (name === "save_obsidian_note") return `save "${args.title}" to your Obsidian vault (Lain/ folder)`;
  return null;
}

function searchNotes(query, limit) {
  const base = resolvedVaultDir();
  const files = walkMarkdownFiles(base, base);
  const q = String(query || "").toLowerCase();
  const matches = [];
  for (const relPath of files) {
    let content;
    try {
      content = fs.readFileSync(path.join(base, relPath), "utf8");
    } catch {
      continue;
    }
    const title = path.basename(relPath, ".md");
    if (title.toLowerCase().includes(q) || content.toLowerCase().includes(q)) {
      matches.push({ title, path: relPath, snippet: snippetAround(content, q) });
    }
    if (matches.length >= limit) break;
  }
  return matches;
}

export async function execute(name, args) {
  if (name === "lookup_obsidian_note") {
    if (!obsidianConfigured()) return { message: "The Obsidian vault isn't connected right now." };
    const limit = Number(args.limit) > 0 ? Number(args.limit) : 5;
    const results = searchNotes(args.query, limit);
    return { results, message: results.length ? undefined : `No notes matched "${args.query}".` };
  }
  if (name === "read_obsidian_note") {
    if (!obsidianConfigured()) return { message: "The Obsidian vault isn't connected right now." };
    let notePath = args.path;
    let full;
    try {
      full = safeResolve(notePath);
    } catch (err) {
      return { error: err.message };
    }
    try {
      const content = fs.readFileSync(full, "utf8");
      return { path: notePath, content };
    } catch {
      // The model frequently drops the .md extension even when the path
      // came straight from lookup_obsidian_note's results — retry once
      // with it appended before giving up, rather than silently failing.
      if (!/\.md$/i.test(notePath)) {
        try {
          notePath = `${notePath}.md`;
          full = safeResolve(notePath);
          const content = fs.readFileSync(full, "utf8");
          return { path: notePath, content };
        } catch {
          // fall through to the error below
        }
      }
      return { error: `Couldn't read "${args.path}" — it may not exist.` };
    }
  }
  if (name === "save_obsidian_note") {
    if (!obsidianConfigured()) return { message: "The Obsidian vault isn't connected right now." };
    const base = resolvedVaultDir();
    const writeDir = path.join(base, WRITE_SUBFOLDER);
    fs.mkdirSync(writeDir, { recursive: true });
    const filename = `${sanitizeFilename(args.title)}.md`;
    const fullPath = path.join(writeDir, filename);
    fs.writeFileSync(fullPath, args.content ?? "", "utf8");
    return { path: path.relative(base, fullPath), title: args.title };
  }
  return undefined;
}

export const CONFIRM_REQUIRED_TOOLS = new Set(["save_obsidian_note"]);
export const CATEGORY_KEYWORDS = ["obsidian", "vault", "my notes", "my vault"];
export const NAMES = new Set(["lookup_obsidian_note", "read_obsidian_note", "save_obsidian_note"]);
