#!/usr/bin/env node
"use strict";

// lain-tools-agent — a small, read-only, token-authenticated HTTP service
// that runs on the user's laptop and lets Lain check system diagnostics,
// look at files (strictly within directories the user has allowed),
// read/change the Omarchy desktop (current theme, active window/workspace),
// do basic digital-forensics-style investigation (file hashing/metadata,
// string extraction, process/connection snapshots, log search, login
// history, and pcap summaries), and apply Lain updates (git pull +
// rebuild/restart) — the only tool here that touches anything outside the
// sandboxed Docker container. Checking *whether* an update is available
// happens separately, straight from the Lain app via the public GitHub
// API (see lib/version.js), so that part works without this agent too.
//
// Security model:
//   - Every request (except /health) requires a bearer token, compared
//     with a constant-time check.
//   - Mostly read-only. The two exceptions that change anything on the
//     laptop are `notify-send` (reminder notifications) and
//     `omarchy-theme-set` (theme switching, only after validating the
//     requested name against the actual installed theme list) — neither
//     can write/delete/read arbitrary files, and both run via execFile
//     with fixed binaries and argument arrays (no shell involved). Every
//     forensics command below is likewise a fixed binary with a fixed or
//     validated argument array — no shell, no string interpolation.
//   - Filesystem access is restricted to LAIN_TOOLS_ALLOWED_ROOTS
//     (resolved to real, absolute paths) and further blocked from a
//     denylist of sensitive paths (SSH/GPG keys, .env files, etc.) even if
//     they happen to live inside an allowed root. This applies to every
//     forensics tool that takes a file/directory path.
//   - System-wide tools (list_processes, network_connections, search_logs,
//     login_history) aren't path-restricted since they don't read
//     arbitrary files — they only report what the agent's own OS user can
//     already see (no privilege escalation; e.g. `ss`/`ps` show only this
//     user's own sockets/processes unless already running as root).
//   - Refuses to start at all if LAIN_TOOLS_TOKEN isn't set.
//
// Install/run via scripts/setup-tools-agent.sh, which sets this up as a
// systemd --user service.


const http = require("node:http");
const os = require("node:os");
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { execFileSync, spawn } = require("node:child_process");

const OMARCHY_STATE_DIR = path.join(os.homedir(), ".local/state/omarchy/current");


const PORT = Number(process.env.LAIN_TOOLS_PORT || 8787);
const TOKEN = process.env.LAIN_TOOLS_TOKEN || "";
// Where the Lain git repo lives on disk — used only by check_for_updates /
// update_lain (git fetch/log, and kicking off scripts/update.sh). Not set
// up as an allowed filesystem root; those two tools are the only ones that
// touch it, via fixed git subcommands / a fixed script path.
const REPO_DIR = process.env.LAIN_REPO_DIR || "";
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

// Extensions we know are binary/non-text — skip these outright when
// batch-reading a directory for summarization (no point trying to decode
// a PDF/image/archive as UTF-8 text).
const BINARY_EXTENSIONS = new Set([
  ".pdf", ".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp", ".ico", ".svg",
  ".zip", ".tar", ".gz", ".xz", ".7z", ".rar",
  ".mp3", ".mp4", ".mov", ".avi", ".mkv", ".wav", ".flac",
  ".exe", ".bin", ".iso", ".dmg", ".appimage",
  ".doc", ".docx", ".xls", ".xlsx", ".ppt", ".pptx",
  ".woff", ".woff2", ".ttf", ".otf",
]);

function looksBinary(buf) {
  // Heuristic: a NUL byte in the first chunk almost always means binary.
  const sample = buf.subarray(0, Math.min(buf.length, 8000));
  return sample.includes(0);
}

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
// escaping the allowed roots (the final isAllowed() check still applies).
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

function requireRepoDir() {
  if (!REPO_DIR) {
    throw new Error(
      "LAIN_REPO_DIR is not configured on the tools agent — re-run " +
        "scripts/setup-tools-agent.sh to set it."
    );
  }
  if (!fs.existsSync(path.join(REPO_DIR, ".git"))) {
    throw new Error(`LAIN_REPO_DIR (${REPO_DIR}) doesn't look like a git repo.`);
  }
}

// Kicks off scripts/update.sh (git pull + resync tools agent + rebuild/
// restart the Lain container) as a detached background process, so it can
// finish restarting lain-tools-agent itself without killing this HTTP
// response mid-flight. Progress is written to a log file the caller can
// mention, but we don't wait around to tail it. (Checking *whether* an
// update is available happens separately, straight from the Lain app via
// the public GitHub API — see lib/version.js — so it works without this
// agent at all; this endpoint only applies one.)
function startUpdate() {
  requireRepoDir();
  const scriptPath = path.join(REPO_DIR, "scripts", "update.sh");
  if (!fs.existsSync(scriptPath)) {
    throw new Error("scripts/update.sh not found in the repo — pull the latest changes first.");
  }
  const logPath = path.join(os.tmpdir(), `lain-update-${Date.now()}.log`);
  const logFd = fs.openSync(logPath, "a");
  const child = spawn("bash", [scriptPath], {
    cwd: REPO_DIR,
    detached: true,
    stdio: ["ignore", logFd, logFd],
  });
  child.unref();
  return { started: true, logFile: logPath };
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

// ---------------------------------------------------------------------------
// Digital-forensics-style tools. File-based ones (hash/metadata/strings/
// pcap) go through isAllowed() like everything else above; the system-wide
// ones (processes/connections/logs/login history) aren't path-restricted
// since they only report what this OS user can already see.
// ---------------------------------------------------------------------------

const MAX_HASH_FILE_BYTES = 10 * 1024 * 1024 * 1024; // 10GB, streamed (not loaded into memory)
const MAX_STRINGS_FILE_BYTES = 200 * 1024 * 1024; // 200MB — strings on bigger files gets slow/huge
const IMAGE_EXTENSIONS_FOR_EXIF = new Set([
  ".jpg", ".jpeg", ".png", ".tif", ".tiff", ".heic", ".heif", ".webp", ".gif", ".bmp", ".raw",
]);
const PCAP_EXTENSIONS = new Set([".pcap", ".pcapng", ".cap"]);

function commandAvailable(bin) {
  try {
    execFileSync("which", [bin], { timeout: 3000, stdio: ["ignore", "ignore", "ignore"] });
    return true;
  } catch {
    return false;
  }
}

// Streams the file once through all requested digest algorithms in parallel
// so a large file (e.g. a disk image) only needs to be read from disk once.
function hashFile(targetPath, algorithms) {
  const stat = fs.statSync(targetPath);
  if (!stat.isFile()) throw new Error("not a file");
  if (stat.size > MAX_HASH_FILE_BYTES) {
    throw new Error(`file too large to hash (max ${MAX_HASH_FILE_BYTES} bytes)`);
  }
  const algos = algorithms && algorithms.length ? algorithms : ["md5", "sha1", "sha256"];
  const hashes = algos.map((algo) => ({ algo, hash: crypto.createHash(algo) }));

  return new Promise((resolve, reject) => {
    const stream = fs.createReadStream(targetPath);
    stream.on("data", (chunk) => {
      for (const { hash } of hashes) hash.update(chunk);
    });
    stream.on("end", () => {
      const result = { path: targetPath, size: stat.size };
      for (const { algo, hash } of hashes) result[algo] = hash.digest("hex");
      resolve(result);
    });
    stream.on("error", reject);
  });
}

function fileMetadata(targetPath) {
  const stat = fs.statSync(targetPath);
  let mimeType = null;
  let fileType = null;
  try {
    mimeType = execFileSync("file", ["--brief", "--mime-type", targetPath], {
      encoding: "utf8",
      timeout: 5000,
    }).trim();
  } catch {
    // `file` not installed or failed — best-effort only.
  }
  try {
    fileType = execFileSync("file", ["--brief", targetPath], {
      encoding: "utf8",
      timeout: 5000,
    }).trim();
  } catch {
    // best-effort only
  }

  let exif = null;
  const ext = path.extname(targetPath).toLowerCase();
  if (stat.isFile() && IMAGE_EXTENSIONS_FOR_EXIF.has(ext) && commandAvailable("exiftool")) {
    try {
      const out = execFileSync("exiftool", ["-json", targetPath], {
        encoding: "utf8",
        timeout: 10000,
        maxBuffer: 5 * 1024 * 1024,
      });
      const parsed = JSON.parse(out);
      exif = parsed[0] || null;
    } catch {
      exif = null; // corrupt/unsupported image, or exiftool missing — best-effort
    }
  }

  return {
    path: targetPath,
    isDirectory: stat.isDirectory(),
    size: stat.size,
    created: stat.birthtime.toISOString(),
    modified: stat.mtime.toISOString(),
    accessed: stat.atime.toISOString(),
    metadataChanged: stat.ctime.toISOString(),
    permissions: (stat.mode & 0o777).toString(8),
    mimeType,
    fileType,
    exif,
  };
}

function extractStrings(targetPath, { minLength, limit }) {
  const stat = fs.statSync(targetPath);
  if (!stat.isFile()) throw new Error("not a file");
  if (stat.size > MAX_STRINGS_FILE_BYTES) {
    throw new Error(`file too large for string extraction (max ${MAX_STRINGS_FILE_BYTES} bytes)`);
  }
  const out = execFileSync("strings", ["-n", String(minLength), targetPath], {
    encoding: "utf8",
    timeout: 20000,
    maxBuffer: 50 * 1024 * 1024,
  });
  const lines = out.split("\n").filter(Boolean);
  return { totalFound: lines.length, strings: lines.slice(0, limit), truncated: lines.length > limit };
}

// `ps aux`-style snapshot, sorted by CPU% descending. Only shows processes
// visible to this OS user (no sudo/privilege escalation involved).
function listProcesses(limit, sortBy) {
  const sortFlag = sortBy === "mem" ? "-%mem" : "-%cpu";
  const out = execFileSync("ps", ["axo", "pid,ppid,user,%cpu,%mem,etime,comm", "--sort=" + sortFlag], {
    encoding: "utf8",
    timeout: 5000,
  });
  const lines = out.trim().split("\n").slice(1); // drop header
  const processes = lines.slice(0, limit).map((line) => {
    const parts = line.trim().split(/\s+/);
    const [pid, ppid, user, cpu, mem, etime, ...commParts] = parts;
    return { pid, ppid, user, cpu, mem, etime, command: commParts.join(" ") };
  });
  return processes;
}

// Active/listening sockets visible to this OS user, via `ss` (no arbitrary
// command construction — fixed flags only).
function networkConnections(limit) {
  const out = execFileSync("ss", ["-tunap"], { encoding: "utf8", timeout: 5000 });
  const lines = out.trim().split("\n").slice(1); // drop header
  return lines.slice(0, limit).map((line) => line.trim());
}

// journalctl search — query is passed as a single execFile argument (`-g`
// pattern), never through a shell, so there's no injection risk regardless
// of its contents.
function searchLogs({ query, since, limit }) {
  const args = ["-q", "--no-pager", "-n", String(limit), "-o", "short-iso"];
  if (since) args.push("--since", since);
  if (query) args.push("-g", query);
  const out = execFileSync("journalctl", args, {
    encoding: "utf8",
    timeout: 10000,
    maxBuffer: 10 * 1024 * 1024,
  });
  return out.trim().split("\n").filter(Boolean);
}

function recentFileActivity(root, { sinceHours, limit }) {
  const cutoff = Date.now() - sinceHours * 3600 * 1000;
  const results = [];
  walk(
    root,
    (file) => {
      if (results.length >= limit * 10) return; // oversample, then sort+trim below
      let stat;
      try {
        stat = fs.statSync(file);
      } catch {
        return;
      }
      if (stat.mtimeMs >= cutoff) {
        results.push({ path: file, modified: stat.mtime.toISOString(), size: stat.size });
      }
    },
    { timeoutMs: 8000, maxEntries: 50000, stopEarly: () => results.length >= limit * 10 }
  );
  results.sort((a, b) => new Date(b.modified) - new Date(a.modified));
  return results.slice(0, limit);
}

function loginHistory(limit) {
  let last = [];
  try {
    const out = execFileSync("last", ["-n", String(limit), "-F"], {
      encoding: "utf8",
      timeout: 5000,
    });
    last = out
      .split("\n")
      .filter((l) => l.trim() && !l.startsWith("wtmp begins"));
  } catch {
    // best-effort only
  }
  let currentlyLoggedIn = [];
  try {
    const out = execFileSync("who", [], { encoding: "utf8", timeout: 5000 });
    currentlyLoggedIn = out.split("\n").filter(Boolean);
  } catch {
    // best-effort only
  }
  return { last, currentlyLoggedIn };
}

// Uses tcpdump (fixed flags, -c bounds runtime/output) to sample up to
// `limit` packets from a pcap file and derive basic protocol/talker stats.
// This is a sample-based summary, not a full-file analysis — no tshark/
// capinfos dependency required.
function analyzePcap(targetPath, limit) {
  const ext = path.extname(targetPath).toLowerCase();
  if (!PCAP_EXTENSIONS.has(ext)) {
    throw new Error("not a recognized pcap file (.pcap/.pcapng/.cap)");
  }
  let out;
  try {
    out = execFileSync("tcpdump", ["-nn", "-r", targetPath, "-c", String(limit)], {
      encoding: "utf8",
      timeout: 20000,
      maxBuffer: 20 * 1024 * 1024,
    });
  } catch (err) {
    // tcpdump can exit non-zero even when it produced useful stdout (e.g.
    // link-type warnings) — fall back to whatever it did output.
    if (err.stdout) out = err.stdout.toString();
    else throw new Error(`tcpdump failed: ${err.message}`);
  }

  const lines = out.split("\n").filter(Boolean);
  const talkers = {};
  const protocols = {};
  for (const line of lines) {
    const hostMatch = line.match(/\bIP6?\s+(\S+)\s*[><]\s*(\S+):/);
    if (hostMatch) {
      const src = hostMatch[1].replace(/\.\d+$/, "");
      const dst = hostMatch[2].replace(/\.\d+$/, "");
      talkers[src] = (talkers[src] || 0) + 1;
      talkers[dst] = (talkers[dst] || 0) + 1;
    }
    // tcpdump's default one-line format doesn't literally print "TCP" —
    // it shows "Flags [...]" for TCP, "UDP, length N" for UDP, etc.
    let proto = null;
    if (/\bFlags \[/.test(line)) proto = "TCP";
    else if (/\bUDP,/.test(line)) proto = "UDP";
    else if (/\bICMP6?\b/.test(line)) proto = "ICMP";
    else if (/^\S+\s+ARP,/.test(line)) proto = "ARP";
    if (proto) protocols[proto] = (protocols[proto] || 0) + 1;
  }
  const topTalkers = Object.entries(talkers)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 15)
    .map(([host, count]) => ({ host, count }));

  return {
    packetsSampled: lines.length,
    protocolCounts: protocols,
    topTalkers,
    samplePackets: lines.slice(0, Math.min(50, lines.length)),
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
      const root = rootArg ? resolveInputPath(rootArg) : ALLOWED_ROOTS[0];
      if (!isAllowed(root)) return send(res, 403, { error: "root not allowed" });
      return send(res, 200, { results: findFiles(query, root, limit) });
    }

    if (url.pathname === "/search") {
      const query = url.searchParams.get("q") || "";
      const rootArg = url.searchParams.get("root");
      const limit = Math.min(Number(url.searchParams.get("limit")) || 20, 50);
      if (!query) return send(res, 400, { error: "q is required" });
      const root = rootArg ? resolveInputPath(rootArg) : ALLOWED_ROOTS[0];
      if (!isAllowed(root)) return send(res, 403, { error: "root not allowed" });
      return send(res, 200, { results: searchFiles(query, root, limit) });
    }

    if (url.pathname === "/list") {
      const rootArg = url.searchParams.get("root");
      const limit = Math.min(Number(url.searchParams.get("limit")) || 100, 500);
      const root = rootArg ? resolveInputPath(rootArg) : ALLOWED_ROOTS[0];
      if (!isAllowed(root)) return send(res, 403, { error: "root not allowed" });
      const stat = fs.statSync(root);
      if (!stat.isDirectory()) return send(res, 400, { error: "not a directory" });
      return send(res, 200, { root, entries: listDirectory(root, limit) });
    }

    if (url.pathname === "/read-dir") {
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
      const resolved = resolveInputPath(p);
      if (!isAllowed(resolved)) return send(res, 403, { error: "path not allowed" });
      const stat = fs.statSync(resolved);
      if (!stat.isFile()) return send(res, 400, { error: "not a file" });
      return send(res, 200, readFileSafe(resolved, maxBytes));
    }

    if (url.pathname === "/hash") {
      const p = url.searchParams.get("path") || "";
      const algosParam = url.searchParams.get("algorithms");
      if (!p) return send(res, 400, { error: "path is required" });
      const resolved = resolveInputPath(p);
      if (!isAllowed(resolved)) return send(res, 403, { error: "path not allowed" });
      const algos = algosParam
        ? algosParam.split(",").map((a) => a.trim().toLowerCase()).filter(Boolean)
        : null;
      return hashFile(resolved, algos)
        .then((result) => send(res, 200, result))
        .catch((err) => send(res, 500, { error: err.message }));
    }

    if (url.pathname === "/metadata") {
      const p = url.searchParams.get("path") || "";
      if (!p) return send(res, 400, { error: "path is required" });
      const resolved = resolveInputPath(p);
      if (!isAllowed(resolved)) return send(res, 403, { error: "path not allowed" });
      return send(res, 200, fileMetadata(resolved));
    }

    if (url.pathname === "/strings") {
      const p = url.searchParams.get("path") || "";
      const minLength = Math.max(Number(url.searchParams.get("minLength")) || 4, 1);
      const limit = Math.min(Number(url.searchParams.get("limit")) || 200, 2000);
      if (!p) return send(res, 400, { error: "path is required" });
      const resolved = resolveInputPath(p);
      if (!isAllowed(resolved)) return send(res, 403, { error: "path not allowed" });
      return send(res, 200, extractStrings(resolved, { minLength, limit }));
    }

    if (url.pathname === "/processes") {
      const limit = Math.min(Number(url.searchParams.get("limit")) || 20, 100);
      const sortBy = url.searchParams.get("sortBy") === "mem" ? "mem" : "cpu";
      return send(res, 200, { processes: listProcesses(limit, sortBy) });
    }

    if (url.pathname === "/connections") {
      const limit = Math.min(Number(url.searchParams.get("limit")) || 50, 200);
      return send(res, 200, { connections: networkConnections(limit) });
    }

    if (url.pathname === "/logs") {
      const query = url.searchParams.get("q") || "";
      const since = url.searchParams.get("since") || "";
      const limit = Math.min(Number(url.searchParams.get("limit")) || 50, 200);
      return send(res, 200, { lines: searchLogs({ query, since, limit }) });
    }

    if (url.pathname === "/recent-activity") {
      const rootArg = url.searchParams.get("root");
      const sinceHours = Math.max(Number(url.searchParams.get("sinceHours")) || 24, 0.1);
      const limit = Math.min(Number(url.searchParams.get("limit")) || 50, 200);
      const root = rootArg ? resolveInputPath(rootArg) : ALLOWED_ROOTS[0];
      if (!isAllowed(root)) return send(res, 403, { error: "root not allowed" });
      const stat = fs.statSync(root);
      if (!stat.isDirectory()) return send(res, 400, { error: "not a directory" });
      return send(res, 200, { root, files: recentFileActivity(root, { sinceHours, limit }) });
    }

    if (url.pathname === "/login-history") {
      const limit = Math.min(Number(url.searchParams.get("limit")) || 20, 100);
      return send(res, 200, loginHistory(limit));
    }

    if (url.pathname === "/update" && req.method === "POST") {
      return send(res, 200, startUpdate());
    }

    if (url.pathname === "/pcap") {
      const p = url.searchParams.get("path") || "";
      const limit = Math.min(Number(url.searchParams.get("limit")) || 500, 5000);
      if (!p) return send(res, 400, { error: "path is required" });
      const resolved = resolveInputPath(p);
      if (!isAllowed(resolved)) return send(res, 403, { error: "path not allowed" });
      return send(res, 200, analyzePcap(resolved, limit));
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
