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

// People (and the model) naturally say things like "/Projects/foo" meaning
// "the Projects folder in my home directory", not the real filesystem root.
// If a path doesn't resolve as given, try it again relative to the home
// directory before giving up — this covers that case without silently
// escaping the allowed roots (the isAllowed() check still applies).
function resolveInputPath(p) {
  const home = os.homedir();
  const asGiven = path.resolve(expandHome(p));
  if (fs.existsSync(asGiven)) return asGiven;
  if (!asGiven.startsWith(home + path.sep) && asGiven !== home) {
    const homeRelative = path.resolve(path.join(home, p));
    if (fs.existsSync(homeRelative)) return homeRelative;
  }
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
