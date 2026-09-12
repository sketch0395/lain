"use strict";

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const crypto = require("node:crypto");
const { execFileSync } = require("node:child_process");
const { ALLOWED_ROOTS } = require("./config");
const { resolveInputPath, isAllowed, walk } = require("./paths");
const { send, readJsonBody } = require("./http");

// ---------------------------------------------------------------------------
// Digital-forensics-style tools. File-based ones (hash/metadata/strings/
// pcap) go through isAllowed() like everything else; the system-wide ones
// (processes/connections/logs/login history) aren't path-restricted since
// they only report what this OS user can already see.
// ---------------------------------------------------------------------------

const MAX_HASH_FILE_BYTES = 10 * 1024 * 1024 * 1024; // 10GB, streamed (not loaded into memory)
const MAX_STRINGS_FILE_BYTES = 200 * 1024 * 1024; // 200MB — strings on bigger files gets slow/huge
const IMAGE_EXTENSIONS_FOR_EXIF = new Set([
  ".jpg", ".jpeg", ".png", ".tif", ".tiff", ".heic", ".heif", ".webp", ".gif", ".bmp", ".raw",
]);
const PCAP_EXTENSIONS = new Set([".pcap", ".pcapng", ".cap"]);
// Every live capture is saved by default (not just summarized in-memory)
// so the user never loses a capture just because they forgot to ask for
// it to be saved — this is where it lands unless a save_path is given.
const DEFAULT_CAPTURE_DIR = path.join(os.homedir(), "Documents", "pcaps");

// Filesystem-safe timestamp for default capture filenames, e.g.
// "2026-09-12T13-40-05".
function timestampForFilename() {
  return new Date().toISOString().replace(/:/g, "-").replace(/\.\d+Z$/, "");
}

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

// Shared by analyzePcap (reads a saved file) and capturePackets (reads
// live traffic) — turns tcpdump's default one-line-per-packet stdout into
// protocol counts + top-talker host stats.
function summarizeTcpdumpOutput(out) {
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

  return summarizeTcpdumpOutput(out);
}

const CAPTURE_DEFAULT_DURATION_SECONDS = 10;
const CAPTURE_MAX_DURATION_SECONDS = 60;
const CAPTURE_DEFAULT_PACKET_LIMIT = 100;
const CAPTURE_MAX_PACKET_LIMIT = 2000;

// Live packet capture, bounded on both ends: `timeout` kills tcpdump after
// `durationSeconds` no matter what, and `-c` stops it early once
// `packetLimit` packets are seen. Requires either running as root or the
// tcpdump binary having the cap_net_raw/cap_net_admin capabilities set
// (setup-tools-agent.sh offers to do this) — otherwise it fails clearly.
//
// `filterExpr`, if given, is a BPF filter (e.g. "tcp port 443", "host
// 8.8.8.8"). It's split on whitespace into separate execFile arguments —
// never passed through a shell — so there's no injection risk regardless
// of its contents, though it does mean quoted/escaped BPF tokens aren't
// supported (not needed for the simple filters this is meant for).
function capturePackets({ interfaceName, filterExpr, durationSeconds, packetLimit, savePath }) {
  if (!commandAvailable("tcpdump")) {
    throw new Error(
      "tcpdump is not installed — install it (e.g. `sudo pacman -S tcpdump`) to capture packets."
    );
  }

  const iface = interfaceName || "any";
  const duration = Math.min(
    Math.max(Number(durationSeconds) || CAPTURE_DEFAULT_DURATION_SECONDS, 1),
    CAPTURE_MAX_DURATION_SECONDS
  );
  const limit = Math.min(
    Math.max(Number(packetLimit) || CAPTURE_DEFAULT_PACKET_LIMIT, 1),
    CAPTURE_MAX_PACKET_LIMIT
  );
  const filterArgs = filterExpr ? String(filterExpr).trim().split(/\s+/).filter(Boolean) : [];

  // Captures are saved by default so nothing is lost just because the user
  // (or the model) forgot to ask for a save_path — pass save: false to opt
  // out and only get the in-memory summary.
  let resolvedSavePath = null;
  if (savePath !== false) {
    const requestedPath =
      typeof savePath === "string" && savePath.trim()
        ? savePath
        : path.join(DEFAULT_CAPTURE_DIR, `capture-${timestampForFilename()}.pcap`);
    resolvedSavePath = resolveInputPath(requestedPath);
    if (!isAllowed(resolvedSavePath)) throw new Error("save path not allowed");
    if (!PCAP_EXTENSIONS.has(path.extname(resolvedSavePath).toLowerCase())) {
      resolvedSavePath += ".pcap";
    }
    // Create any missing parent folders (e.g. "~/Documents/pcaps/") so the
    // user/model can name a brand-new location without a separate mkdir
    // step first. Still bounded by isAllowed() above — every ancestor of an
    // allowed path is itself inside the same allowed root.
    const destDir = path.dirname(resolvedSavePath);
    if (!isAllowed(destDir)) throw new Error("save path not allowed");
    fs.mkdirSync(destDir, { recursive: true });
  }

  const baseArgs = ["-nn", "-i", iface, "-c", String(limit)];
  const args = resolvedSavePath
    ? [...baseArgs, "-w", resolvedSavePath, ...filterArgs]
    : [...baseArgs, ...filterArgs];

  let out = "";
  try {
    out = execFileSync("timeout", [`${duration}s`, "tcpdump", ...args], {
      encoding: "utf8",
      // A little longer than `duration` so `timeout` itself is what stops
      // tcpdump, not Node's own timeout mid-write.
      timeout: (duration + 10) * 1000,
      maxBuffer: 20 * 1024 * 1024,
    });
  } catch (err) {
    // `timeout` exits 124 when it has to kill tcpdump — expected, not an
    // error, as long as we got output. Permission errors (no root/no
    // capabilities) come through stderr instead.
    if (err.stdout !== undefined) out = err.stdout.toString();
    const stderr = (err.stderr || "").toString();
    if (/permission|not permitted|cap_net_raw/i.test(stderr)) {
      throw new Error(
        "tcpdump couldn't open the interface (permission denied). Grant it packet-capture " +
          "rights, e.g. `sudo setcap cap_net_raw,cap_net_admin+eip $(command -v tcpdump)`, " +
          "then try again."
      );
    }
    // With -w, tcpdump never prints decoded packets to stdout — its normal
    // "N packets captured" summary always goes to stderr, even on a
    // perfectly successful, `timeout`-terminated capture. So stderr text
    // alone isn't a failure signal when we're saving to a file; only treat
    // it as fatal if the file wasn't actually written.
    if (resolvedSavePath) {
      if (!fs.existsSync(resolvedSavePath)) {
        throw new Error(`tcpdump failed: ${stderr.trim() || err.message}`);
      }
    } else if (!out && stderr) {
      throw new Error(`tcpdump failed: ${stderr.trim()}`);
    } else if (!out) {
      throw new Error(`tcpdump failed: ${err.message}`);
    }
  }

  if (resolvedSavePath) {
    // With -w, tcpdump doesn't print decoded packet lines — read back the
    // file it just wrote to build the same summary shape as analyzePcap.
    const summary = analyzePcap(resolvedSavePath, limit);
    return { ...summary, savedTo: resolvedSavePath };
  }

  return summarizeTcpdumpOutput(out);
}

function registerRoutes(router) {
  router.any("/hash", (req, res, url) => {
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
  });

  router.any("/metadata", (req, res, url) => {
    const p = url.searchParams.get("path") || "";
    if (!p) return send(res, 400, { error: "path is required" });
    const resolved = resolveInputPath(p);
    if (!isAllowed(resolved)) return send(res, 403, { error: "path not allowed" });
    return send(res, 200, fileMetadata(resolved));
  });

  router.any("/strings", (req, res, url) => {
    const p = url.searchParams.get("path") || "";
    const minLength = Math.max(Number(url.searchParams.get("minLength")) || 4, 1);
    const limit = Math.min(Number(url.searchParams.get("limit")) || 200, 2000);
    if (!p) return send(res, 400, { error: "path is required" });
    const resolved = resolveInputPath(p);
    if (!isAllowed(resolved)) return send(res, 403, { error: "path not allowed" });
    return send(res, 200, extractStrings(resolved, { minLength, limit }));
  });

  router.any("/processes", (req, res, url) => {
    const limit = Math.min(Number(url.searchParams.get("limit")) || 20, 100);
    const sortBy = url.searchParams.get("sortBy") === "mem" ? "mem" : "cpu";
    return send(res, 200, { processes: listProcesses(limit, sortBy) });
  });

  router.any("/connections", (req, res, url) => {
    const limit = Math.min(Number(url.searchParams.get("limit")) || 50, 200);
    return send(res, 200, { connections: networkConnections(limit) });
  });

  router.any("/logs", (req, res, url) => {
    const query = url.searchParams.get("q") || "";
    const since = url.searchParams.get("since") || "";
    const limit = Math.min(Number(url.searchParams.get("limit")) || 50, 200);
    return send(res, 200, { lines: searchLogs({ query, since, limit }) });
  });

  router.any("/recent-activity", (req, res, url) => {
    const rootArg = url.searchParams.get("root");
    const sinceHours = Math.max(Number(url.searchParams.get("sinceHours")) || 24, 0.1);
    const limit = Math.min(Number(url.searchParams.get("limit")) || 50, 200);
    const root = rootArg ? resolveInputPath(rootArg) : ALLOWED_ROOTS[0];
    if (!isAllowed(root)) return send(res, 403, { error: "root not allowed" });
    const stat = fs.statSync(root);
    if (!stat.isDirectory()) return send(res, 400, { error: "not a directory" });
    return send(res, 200, { root, files: recentFileActivity(root, { sinceHours, limit }) });
  });

  router.any("/login-history", (req, res, url) => {
    const limit = Math.min(Number(url.searchParams.get("limit")) || 20, 100);
    return send(res, 200, loginHistory(limit));
  });

  router.any("/pcap", (req, res, url) => {
    const p = url.searchParams.get("path") || "";
    const limit = Math.min(Number(url.searchParams.get("limit")) || 500, 5000);
    if (!p) return send(res, 400, { error: "path is required" });
    const resolved = resolveInputPath(p);
    if (!isAllowed(resolved)) return send(res, 403, { error: "path not allowed" });
    return send(res, 200, analyzePcap(resolved, limit));
  });

  // POST (not GET) since this actively runs a live capture for a bounded
  // duration rather than just reading existing state.
  router.post("/capture", async (req, res) => {
    const body = await readJsonBody(req);
    try {
      send(
        res,
        200,
        capturePackets({
          interfaceName: body.interface,
          filterExpr: body.filter,
          durationSeconds: body.duration,
          packetLimit: body.limit,
          savePath: body.savePath,
        })
      );
    } catch (err) {
      send(res, 500, { error: err.message });
    }
  });
}

module.exports = {
  commandAvailable,
  hashFile,
  fileMetadata,
  extractStrings,
  listProcesses,
  networkConnections,
  searchLogs,
  recentFileActivity,
  loginHistory,
  analyzePcap,
  capturePackets,
  registerRoutes,
};
