"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { NOTES_DIR } = require("./config");
const { isAllowed } = require("./paths");
const { send, readJsonBody } = require("./http");

// ---------------------------------------------------------------------------
// create_note: writes/appends/replaces markdown (.md) note files under
// NOTES_DIR (defaults to ~/Documents, configurable via
// LAIN_TOOLS_NOTES_DIR). Sandboxed by the same isAllowed() check as every
// other filesystem-touching tool.
// ---------------------------------------------------------------------------

// Turns an arbitrary title into a safe, filesystem-friendly base filename —
// no path separators or traversal sequences can survive this, so the
// resulting path is always a direct child of NOTES_DIR.
function slugifyTitle(title) {
  const slug = String(title || "note")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
  return slug || "note";
}

// Small/fast models occasionally emit a literal backslash-n (two chars)
// instead of a real newline inside JSON string content, which then shows
// up as visible "\n" text in the saved note. Normalize that away.
function sanitizeNoteContent(content) {
  if (typeof content !== "string") return content;
  return content.replace(/\\n/g, "\n").replace(/\\t/g, "\t");
}

function createNote(title, content, mode = "create") {
  content = sanitizeNoteContent(content);
  if (!isAllowed(NOTES_DIR)) {
    throw new Error(
      `Notes directory (${NOTES_DIR}) is not inside an allowed root ` +
        `(LAIN_TOOLS_ALLOWED_ROOTS). Add it or set LAIN_TOOLS_NOTES_DIR.`
    );
  }
  fs.mkdirSync(NOTES_DIR, { recursive: true });

  const slug = slugifyTitle(title);
  const baseFilename = `${slug}.md`;
  const basePath = path.join(NOTES_DIR, baseFilename);
  const baseExists = fs.existsSync(basePath);

  // append/replace only apply to an existing note with this exact title —
  // if none exists yet, fall through to normal "create" behavior below.
  if (mode === "append" && baseExists) {
    fs.appendFileSync(basePath, `\n${content || ""}\n`, "utf8");
    return { path: basePath, filename: baseFilename, mode: "appended" };
  }
  if (mode === "replace" && baseExists) {
    const body = title ? `# ${title}\n\n${content || ""}\n` : `${content || ""}\n`;
    fs.writeFileSync(basePath, body, "utf8");
    return { path: basePath, filename: baseFilename, mode: "replaced" };
  }

  // "create" (or append/replace with no existing note to target): always
  // makes a new file, auto-incrementing the name instead of overwriting.
  let filename = baseFilename;
  let fullPath = basePath;
  let n = 2;
  while (fs.existsSync(fullPath)) {
    filename = `${slug}-${n}.md`;
    fullPath = path.join(NOTES_DIR, filename);
    n++;
  }

  const body = title ? `# ${title}\n\n${content || ""}\n` : `${content || ""}\n`;
  fs.writeFileSync(fullPath, body, "utf8");
  return { path: fullPath, filename, mode: "created" };
}

function registerRoutes(router) {
  router.post("/note", async (req, res) => {
    try {
      const { title, content, mode } = await readJsonBody(req);
      if (!content && !title) {
        return send(res, 400, { error: "title or content is required" });
      }
      if (mode && !["create", "append", "replace"].includes(mode)) {
        return send(res, 400, { error: "mode must be create, append, or replace" });
      }
      send(res, 200, createNote(title, content, mode || "create"));
    } catch (err) {
      send(res, 500, { error: err.message });
    }
  });
}

module.exports = { createNote, registerRoutes };
