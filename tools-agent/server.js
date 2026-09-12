#!/usr/bin/env node
"use strict";

// lain-tools-agent — a small, read-only, token-authenticated HTTP service
// that runs on the user's laptop and lets Lain check system diagnostics,
// look at files (strictly within directories the user has allowed), and
// read/change the Omarchy desktop (current theme, active window/workspace).
//
// Security model:
//   - Every request (except /health) requires a bearer token, compared
//     with a constant-time check.
//   - Mostly read-only. The two exceptions that change anything on the
//     laptop are `notify-send` (reminder notifications) and
//     `omarchy-theme-set` (theme switching, only after validating the
//     requested name against the actual installed theme list) — neither
//     can write/delete/read arbitrary files, and both run via execFile
//     with fixed binaries and argument arrays (no shell involved).
//   - Filesystem access is restricted to LAIN_TOOLS_ALLOWED_ROOTS
//     (resolved to real, absolute paths) and further blocked from a
//     denylist of sensitive paths (SSH/GPG keys, .env files, etc.) even if
//     they happen to live inside an allowed root.
//   - Refuses to start at all if LAIN_TOOLS_TOKEN isn't set.
//
// Install/run via scripts/setup-tools-agent.sh, which sets this up as a
// systemd --user service.


const http = require("node:http");
const os = require("node:os");
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { execFileSync } = require("node:child_process");

const OMARCHY_STATE_DIR = path.join(os.homedir(), ".local/state/omarchy/current");

const PORT = Number(process.env.LAIN_TOOLS_PORT || 8787);
const TOKEN = process.env.LAIN_TOOLS_TOKEN || "";
const ALLOWED_ROOTS = (process.env.LAIN_TOOLS_ALLOWED_ROOTS || os.homedir())
  .split(",")
  .map((p) => p.trim())
  .filter(Boolean)
  .map((p) => path.resolve(p));

const DENY_PATTERNS = [
  /(^|\/)\.ssh(\/|$)/i,
  /(^|\/)\.gnupg(\/|$)/i,
  /(^|\/)\.config\/lain(\/|$)/i,
  /(^|\/)\.aws(\/|$)/i,
  /(^|\/)\.docker\/config\.json$/i,
  /(^|\/)\.env(\..*)?$/i,
  /id_rsa/i,
  /id_ed25519/i,
  /\.pem$/i,
  /\.key$/i,
  /(^|\/)\.gitconfig$/i,
];

const SKIP_DIRS = new Set([
  "node_modules",
  ".git",
  ".cache",
  "dist",
  "build",
  ".next",
  ".venv",
  "venv",
  "__pycache__",
]);

const MAX_FILE_SCAN_BYTES = 1_500_000; // skip large/binary-ish files in search
const DEFAULT_WALK_TIMEOUT_MS = 4000;
const DEFAULT_WALK_MAX_ENTRIES = 20000;

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

function checkAuth(req) {
  if (!TOKEN) return false;
  const header = req.headers["authorization"] || "";
  const [scheme, token] = header.split(" ");
  if (scheme !== "Bearer" || !token) return false;
  const a = Buffer.from(token);
  const b = Buffer.from(TOKEN);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function send(res, status, body) {
  const json = JSON.stringify(body);
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(json);
}

function notify(title, body) {
  // Best-effort desktop notification via notify-send. Fixed binary, args are
  // passed as separate execFile arguments (no shell), so there's no
  // injection risk even though title/body come from Lain's reminders.
  execFileSync("notify-send", ["--app-name=Lain", title || "Lain", body || ""], {
    timeout: 5000,
  });
}

function diagnostics() {
  let disk = "unavailable";
  try {
    disk = execFileSync("df", ["-h"], { encoding: "utf8", timeout: 5000 });
  } catch {
    // best-effort only
  }
  return {
    hostname: os.hostname(),
    platform: os.platform(),
    uptimeSeconds: Math.round(os.uptime()),
    loadavg: os.loadavg(),
    cpuCount: os.cpus().length,
    totalMemMB: Math.round(os.totalmem() / 1024 / 1024),
    freeMemMB: Math.round(os.freemem() / 1024 / 1024),
    disk,
  };
}

function hyprctlJson(args) {
  try {
    const out = execFileSync("hyprctl", ["-j", ...args], {
      encoding: "utf8",
      timeout: 5000,
    });
    return JSON.parse(out);
  } catch {
    return null;
  }
}

function omarchyStatus() {
  let theme = "unknown";
  try {
    theme = fs.readFileSync(path.join(OMARCHY_STATE_DIR, "theme.name"), "utf8").trim();
  } catch {
    // best-effort only
  }

  const activeWorkspace = hyprctlJson(["activeworkspace"]);
  const clients = hyprctlJson(["clients"]) || [];
  const monitors = hyprctlJson(["monitors"]) || [];
  const activeClient = hyprctlJson(["activewindow"]);

  return {
    theme,
    activeWorkspace: activeWorkspace
      ? { id: activeWorkspace.id, name: activeWorkspace.name, monitor: activeWorkspace.monitor }
      : null,
    activeWindow: activeClient
      ? { class: activeClient.class, title: activeClient.title }
      : null,
    monitors: monitors.map((m) => ({
      name: m.name,
      activeWorkspace: m.activeWorkspace && m.activeWorkspace.name,
      focused: Boolean(m.focused),
    })),
    windowCount: clients.length,
  };
}

function omarchyThemeList() {
  const out = execFileSync("omarchy-theme-list", [], {
    encoding: "utf8",
    timeout: 5000,
  });
  return out
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}

function omarchySetTheme(themeName) {
  // Validate against the actual installed theme list first, so we only ever
  // pass a known-good value to execFile (no shell involved either way, but
  // this also gives a clean error instead of omarchy-theme-set's own).
  const available = omarchyThemeList();
  if (!available.includes(themeName)) {
    throw new Error(`Unknown theme "${themeName}". Available: ${available.join(", ")}`);
  }
  execFileSync("omarchy-theme-set", [themeName], { timeout: 10000 });
  return { theme: themeName };
}

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

function readFileSafe(targetPath, maxBytes) {
  const buf = fs.readFileSync(targetPath);
  const truncated = buf.length > maxBytes;
  return {
    content: buf.subarray(0, maxBytes).toString("utf8"),
    truncated,
    size: buf.length,
  };
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);

  // /health is allowed without auth solely so a load balancer or `curl`
  // can sanity-check the process is up; it reveals nothing sensitive.
  if (url.pathname === "/health" && req.method === "GET") {
    return send(res, 200, { ok: true });
  }

  if (!checkAuth(req)) return send(res, 401, { error: "unauthorized" });

  try {
    if (url.pathname === "/diagnostics") {
      return send(res, 200, diagnostics());
    }

    if (url.pathname === "/omarchy/status" && req.method === "GET") {
      return send(res, 200, omarchyStatus());
    }

    if (url.pathname === "/omarchy/themes" && req.method === "GET") {
      return send(res, 200, { themes: omarchyThemeList() });
    }

    if (url.pathname === "/omarchy/theme" && req.method === "POST") {
      let raw = "";
      req.on("data", (chunk) => (raw += chunk));
      return new Promise((resolve) => {
        req.on("end", () => {
          try {
            const { theme } = JSON.parse(raw || "{}");
            if (!theme) {
              send(res, 400, { error: "theme is required" });
            } else {
              send(res, 200, omarchySetTheme(theme));
            }
          } catch (err) {
            send(res, 500, { error: err.message });
          }
          resolve();
        });
      });
    }

    if (url.pathname === "/find") {
      const query = url.searchParams.get("q") || "";
      const rootArg = url.searchParams.get("root");
      const limit = Math.min(Number(url.searchParams.get("limit")) || 30, 100);
      if (!query) return send(res, 400, { error: "q is required" });
      const root = rootArg ? path.resolve(rootArg) : ALLOWED_ROOTS[0];
      if (!isAllowed(root)) return send(res, 403, { error: "root not allowed" });
      return send(res, 200, { results: findFiles(query, root, limit) });
    }

    if (url.pathname === "/search") {
      const query = url.searchParams.get("q") || "";
      const rootArg = url.searchParams.get("root");
      const limit = Math.min(Number(url.searchParams.get("limit")) || 20, 50);
      if (!query) return send(res, 400, { error: "q is required" });
      const root = rootArg ? path.resolve(rootArg) : ALLOWED_ROOTS[0];
      if (!isAllowed(root)) return send(res, 403, { error: "root not allowed" });
      return send(res, 200, { results: searchFiles(query, root, limit) });
    }

    if (url.pathname === "/notify" && req.method === "POST") {
      let raw = "";
      req.on("data", (chunk) => (raw += chunk));
      return new Promise((resolve) => {
        req.on("end", () => {
          try {
            const { title, body } = JSON.parse(raw || "{}");
            notify(title, body);
            send(res, 200, { ok: true });
          } catch (err) {
            send(res, 500, { error: err.message });
          }
          resolve();
        });
      });
    }

    if (url.pathname === "/read") {
      const p = url.searchParams.get("path") || "";
      const maxBytes = Math.min(Number(url.searchParams.get("max")) || 20000, 100000);
      if (!p) return send(res, 400, { error: "path is required" });
      const resolved = path.resolve(p);
      if (!isAllowed(resolved)) return send(res, 403, { error: "path not allowed" });
      const stat = fs.statSync(resolved);
      if (!stat.isFile()) return send(res, 400, { error: "not a file" });
      return send(res, 200, readFileSafe(resolved, maxBytes));
    }

    return send(res, 404, { error: "not found" });
  } catch (err) {
    return send(res, 500, { error: err.message });
  }
});

if (!TOKEN) {
  console.error(
    "lain-tools-agent: LAIN_TOOLS_TOKEN is not set — refusing to start " +
      "(this would allow unauthenticated access to your filesystem)."
  );
  process.exit(1);
}

server.listen(PORT, () => {
  console.log(
    `lain-tools-agent listening on :${PORT}, allowed roots: ${ALLOWED_ROOTS.join(", ")}`
  );
});
