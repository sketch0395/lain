"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { SKIP_DIRS, MAX_FILE_SCAN_BYTES, BINARY_EXTENSIONS, ALLOWED_ROOTS } = require("./config");
const { resolveInputPath, isAllowed, looksBinary, walk } = require("./paths");
const { send } = require("./http");

function findFiles(query, root, limit) {
  const results = [];
  const q = query.toLowerCase();
  walk(
    root,
    (file) => {
      if (results.length >= limit) return;
      if (path.basename(file).toLowerCase().includes(q)) {
        results.push(file);
      }
    },
    { stopEarly: () => results.length >= limit }
  );
  return results;
}

function searchFiles(query, root, limit) {
  const results = [];
  const q = query.toLowerCase();
  walk(
    root,
    (file) => {
      if (results.length >= limit) return;
      let stat;
      try {
        stat = fs.statSync(file);
      } catch {
        return;
      }
      if (stat.size > MAX_FILE_SCAN_BYTES) return;
      let content;
      try {
        content = fs.readFileSync(file, "utf8");
      } catch {
        return; // likely binary or unreadable
      }
      const idx = content.toLowerCase().indexOf(q);
      if (idx !== -1) {
        const start = Math.max(0, idx - 60);
        const snippet = content
          .slice(start, idx + q.length + 60)
          .replace(/\s+/g, " ")
          .trim();
        results.push({ file, snippet });
      }
    },
    { stopEarly: () => results.length >= limit }
  );
  return results;
}

// Non-recursive listing of a directory's immediate contents — used so Lain
// can see what's actually in e.g. ~/Downloads before deciding what to read.
function listDirectory(root, limit) {
  const entries = fs.readdirSync(root, { withFileTypes: true });
  const items = [];
  for (const entry of entries) {
    if (entry.isDirectory() && SKIP_DIRS.has(entry.name)) continue;
    const full = path.join(root, entry.name);
    let stat;
    try {
      stat = fs.statSync(full);
    } catch {
      continue;
    }
    items.push({
      name: entry.name,
      type: entry.isDirectory() ? "dir" : "file",
      size: entry.isDirectory() ? null : stat.size,
      modified: stat.mtime.toISOString(),
    });
  }
  // Most-recently-modified first — usually what you want for "what's in Downloads".
  items.sort((a, b) => new Date(b.modified) - new Date(a.modified));
  return items.slice(0, limit);
}

// Batch-reads the (text) files directly inside a directory, for
// summarization. Non-recursive, skips known-binary extensions and anything
// that looks binary on inspection, and stops once either the file count or
// total byte budget is hit so a big folder can't blow out the model's context.
function readDirectory(root, { limit, maxBytesPerFile, maxTotalBytes }) {
  const entries = fs
    .readdirSync(root, { withFileTypes: true })
    .filter((e) => e.isFile());

  const withStats = entries
    .map((e) => {
      const full = path.join(root, e.name);
      let stat;
      try {
        stat = fs.statSync(full);
      } catch {
        return null;
      }
      return { name: e.name, path: full, size: stat.size, modified: stat.mtime };
    })
    .filter(Boolean)
    .sort((a, b) => b.modified - a.modified);

  const results = [];
  let totalBytes = 0;

  for (const item of withStats) {
    if (results.length >= limit) break;

    const ext = path.extname(item.name).toLowerCase();
    if (BINARY_EXTENSIONS.has(ext)) {
      results.push({ name: item.name, size: item.size, skipped: "binary file type" });
      continue;
    }
    if (item.size > MAX_FILE_SCAN_BYTES) {
      results.push({ name: item.name, size: item.size, skipped: "file too large" });
      continue;
    }
    if (totalBytes >= maxTotalBytes) {
      results.push({ name: item.name, size: item.size, skipped: "byte budget reached" });
      continue;
    }

    let buf;
    try {
      buf = fs.readFileSync(item.path);
    } catch {
      results.push({ name: item.name, size: item.size, skipped: "unreadable" });
      continue;
    }
    if (looksBinary(buf)) {
      results.push({ name: item.name, size: item.size, skipped: "binary content" });
      continue;
    }

    const remainingBudget = maxTotalBytes - totalBytes;
    const cap = Math.min(maxBytesPerFile, remainingBudget);
    const truncated = buf.length > cap;
    const content = buf.subarray(0, cap).toString("utf8");
    totalBytes += content.length;

    results.push({ name: item.name, size: item.size, content, truncated });
  }

  return results;
}

function readFileSafe(targetPath, maxBytes) {
  const buf = fs.readFileSync(targetPath);
  const truncated = buf.length > maxBytes;
  return {
    content: buf.subarray(0, maxBytes).toString("utf8"),
    truncated,
    size: buf.length,
  };
}

function registerRoutes(router) {
  router.any("/find", (req, res, url) => {
    const query = url.searchParams.get("q") || "";
    const rootArg = url.searchParams.get("root");
    const limit = Math.min(Number(url.searchParams.get("limit")) || 30, 100);
    if (!query) return send(res, 400, { error: "q is required" });
    const root = rootArg ? resolveInputPath(rootArg) : ALLOWED_ROOTS[0];
    if (!isAllowed(root)) return send(res, 403, { error: "root not allowed" });
    return send(res, 200, { results: findFiles(query, root, limit) });
  });

  router.any("/search", (req, res, url) => {
    const query = url.searchParams.get("q") || "";
    const rootArg = url.searchParams.get("root");
    const limit = Math.min(Number(url.searchParams.get("limit")) || 20, 50);
    if (!query) return send(res, 400, { error: "q is required" });
    const root = rootArg ? resolveInputPath(rootArg) : ALLOWED_ROOTS[0];
    if (!isAllowed(root)) return send(res, 403, { error: "root not allowed" });
    return send(res, 200, { results: searchFiles(query, root, limit) });
  });

  router.any("/list", (req, res, url) => {
    const rootArg = url.searchParams.get("root");
    const limit = Math.min(Number(url.searchParams.get("limit")) || 100, 500);
    const root = rootArg ? resolveInputPath(rootArg) : ALLOWED_ROOTS[0];
    if (!isAllowed(root)) return send(res, 403, { error: "root not allowed" });
    const stat = fs.statSync(root);
    if (!stat.isDirectory()) return send(res, 400, { error: "not a directory" });
    return send(res, 200, { root, entries: listDirectory(root, limit) });
  });

  router.any("/read-dir", (req, res, url) => {
    const rootArg = url.searchParams.get("root");
    const limit = Math.min(Number(url.searchParams.get("limit")) || 10, 25);
    const maxBytesPerFile = Math.min(
      Number(url.searchParams.get("maxBytesPerFile")) || 6000,
      30000
    );
    const maxTotalBytes = Math.min(
      Number(url.searchParams.get("maxTotalBytes")) || 30000,
      100000
    );
    const root = rootArg ? resolveInputPath(rootArg) : ALLOWED_ROOTS[0];
    if (!isAllowed(root)) return send(res, 403, { error: "root not allowed" });
    const stat = fs.statSync(root);
    if (!stat.isDirectory()) return send(res, 400, { error: "not a directory" });
    return send(res, 200, {
      root,
      files: readDirectory(root, { limit, maxBytesPerFile, maxTotalBytes }),
    });
  });

  router.any("/read", (req, res, url) => {
    const p = url.searchParams.get("path") || "";
    const maxBytes = Math.min(Number(url.searchParams.get("max")) || 20000, 100000);
    if (!p) return send(res, 400, { error: "path is required" });
    const resolved = resolveInputPath(p);
    if (!isAllowed(resolved)) return send(res, 403, { error: "path not allowed" });
    const stat = fs.statSync(resolved);
    if (!stat.isFile()) return send(res, 400, { error: "not a file" });
    return send(res, 200, readFileSafe(resolved, maxBytes));
  });
}

module.exports = {
  findFiles,
  searchFiles,
  listDirectory,
  readDirectory,
  readFileSafe,
  registerRoutes,
};
