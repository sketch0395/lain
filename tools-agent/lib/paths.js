"use strict";

// Path-resolution and filesystem-sandboxing helpers shared by every route
// module that touches the filesystem (files.js, forensics.js).

const os = require("node:os");
const fs = require("node:fs");
const path = require("node:path");
const {
  ALLOWED_ROOTS,
  DENY_PATTERNS,
  SKIP_DIRS,
  DEFAULT_WALK_TIMEOUT_MS,
  DEFAULT_WALK_MAX_ENTRIES,
} = require("./config");

function expandHome(p) {
  if (!p) return p;
  if (p === "~") return os.homedir();
  if (p.startsWith("~/") || p.startsWith("~\\")) {
    return path.join(os.homedir(), p.slice(2));
  }
  return p;
}

// Extensions to try appending to the final path segment when a literal
// lookup fails and the segment has no extension of its own — covers the
// model guessing a note's title without remembering it's a .md file.
const GUESS_EXTENSIONS = [".md", ".txt", ".markdown"];

// Walks `base` down through `segments`, matching each one case-insensitively
// against the real directory entries (Linux paths are case-sensitive, but
// people and the model often aren't when recalling a name from memory). On
// the final segment, also tries GUESS_EXTENSIONS if no exact/case-insensitive
// match exists. Returns the resolved absolute path, or null if any segment
// along the way can't be found.
function resolveCaseInsensitive(base, segments) {
  let current = base;
  for (let i = 0; i < segments.length; i++) {
    const segment = segments[i];
    const isLast = i === segments.length - 1;
    let entries;
    try {
      entries = fs.readdirSync(current, { withFileTypes: true });
    } catch {
      return null;
    }
    const exact = entries.find((e) => e.name === segment);
    if (exact) {
      current = path.join(current, exact.name);
      continue;
    }
    const ci = entries.find(
      (e) => e.name.toLowerCase() === segment.toLowerCase()
    );
    if (ci) {
      current = path.join(current, ci.name);
      continue;
    }
    if (isLast) {
      const withExt = entries.find((e) =>
        GUESS_EXTENSIONS.some(
          (ext) => e.name.toLowerCase() === (segment + ext).toLowerCase()
        )
      );
      if (withExt) {
        current = path.join(current, withExt.name);
        continue;
      }
    }
    return null;
  }
  return current;
}

// People (and the model) naturally say things like "/Projects/foo" meaning
// "the Projects folder in my home directory", not the real filesystem root.
// If a path doesn't resolve as given, try it again relative to the home
// directory before giving up — this covers that case without silently
// escaping the allowed roots (the isAllowed() check still applies). As a
// last resort, retry case-insensitively (and with a guessed file extension
// on the last segment) since exact case/extension is easy to misremember.
function resolveInputPath(p) {
  const home = os.homedir();
  const asGiven = path.resolve(expandHome(p));
  if (fs.existsSync(asGiven)) return asGiven;
  if (!asGiven.startsWith(home + path.sep) && asGiven !== home) {
    const homeRelative = path.resolve(path.join(home, p));
    if (fs.existsSync(homeRelative)) return homeRelative;
  }

  const relativeToHome = asGiven.startsWith(home + path.sep)
    ? asGiven.slice(home.length + 1)
    : expandHome(p).replace(/^\/+/, "");
  const segments = relativeToHome.split(path.sep).filter(Boolean);
  const ciResolved = resolveCaseInsensitive(home, segments);
  if (ciResolved) return ciResolved;

  return asGiven;
}

function isAllowed(targetPath) {
  let real;
  try {
    real = fs.realpathSync(targetPath);
  } catch {
    real = path.resolve(targetPath);
  }
  const insideRoot = ALLOWED_ROOTS.some(
    (root) => real === root || real.startsWith(root + path.sep)
  );
  if (!insideRoot) return false;
  return !DENY_PATTERNS.some((re) => re.test(real));
}

// Heuristic: a NUL byte in the first chunk almost always means binary.
function looksBinary(buf) {
  const sample = buf.subarray(0, Math.min(buf.length, 8000));
  return sample.includes(0);
}

// Depth-first directory walk, bounded by a time budget and max entry count
// so a huge/slow directory tree can't hang a request. `visit(filePath)` is
// called for every file found; directories in SKIP_DIRS or outside the
// allowed roots are pruned.
function walk(root, visit, opts = {}) {
  const start = Date.now();
  const timeoutMs = opts.timeoutMs || DEFAULT_WALK_TIMEOUT_MS;
  const maxEntries = opts.maxEntries || DEFAULT_WALK_MAX_ENTRIES;
  const stack = [root];
  let visited = 0;

  while (stack.length) {
    if (Date.now() - start > timeoutMs) break;
    if (visited > maxEntries) break;
    if (opts.stopEarly && opts.stopEarly()) break;

    const dir = stack.pop();
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const entry of entries) {
      visited++;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (SKIP_DIRS.has(entry.name)) continue;
        if (!isAllowed(full)) continue;
        stack.push(full);
      } else if (entry.isFile()) {
        if (opts.stopEarly && opts.stopEarly()) return;
        visit(full);
      }
    }
  }
}

module.exports = { expandHome, resolveInputPath, isAllowed, looksBinary, walk };
