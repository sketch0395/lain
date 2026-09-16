"use strict";

// Network diagnostic tools: ping, DNS lookup, traceroute, whois, and a
// basic TCP port scan. Unlike the file-based forensics tools, none of
// these are path-restricted (they don't read the filesystem) — but every
// external command runs via execFile with a fixed binary and argument
// array (no shell, no string interpolation), and the target itself is
// validated before being handed to any binary, so there's no way to
// smuggle extra flags in via a hostname like "-oProxyCommand=...".
//
// These intentionally run here (the tools-agent, on the user's own
// laptop) rather than from inside the Lain/Asuna Docker container, so
// "local network" actually means the user's LAN — not whatever network
// namespace the container happens to be attached to.

const dns = require("node:dns");
const net = require("node:net");
const { execFileSync } = require("node:child_process");
const { send } = require("./http");

const PING_TIMEOUT_MS = 15000;
const TRACEROUTE_TIMEOUT_MS = 30000;
const WHOIS_TIMEOUT_MS = 15000;
const MAX_PING_COUNT = 10;
const MAX_TRACEROUTE_HOPS = 30;
const MAX_PORT_SCAN_PORTS = 256;
const PORT_SCAN_CONNECT_TIMEOUT_MS = 800;
const PORT_SCAN_CONCURRENCY = 32;

// A conservative allowlist for hostnames/IPs handed to execFile'd binaries.
// Blocks anything that could look like a flag (leading "-") or contain
// shell-metacharacter-adjacent junk, without needing a full RFC-1123
// validator — execFile already prevents shell injection, this is just
// about not letting a hostname be misread as an extra CLI flag.
const HOST_PATTERN = /^[a-zA-Z0-9](?:[a-zA-Z0-9.:_-]{0,253}[a-zA-Z0-9])?$/;

function assertValidHost(host) {
  const h = String(host || "").trim();
  if (!h) throw new Error("host is required");
  if (!HOST_PATTERN.test(h)) throw new Error("invalid host/IP");
  return h;
}

function commandAvailable(bin) {
  try {
    execFileSync("which", [bin], { timeout: 3000, stdio: ["ignore", "ignore", "ignore"] });
    return true;
  } catch {
    return false;
  }
}

// --- ping ------------------------------------------------------------------

function pingHost(host, count) {
  const target = assertValidHost(host);
  const n = Math.min(Math.max(Number(count) || 4, 1), MAX_PING_COUNT);
  let out;
  try {
    out = execFileSync("ping", ["-c", String(n), "-W", "2", target], {
      encoding: "utf8",
      timeout: PING_TIMEOUT_MS,
    });
  } catch (err) {
    // ping exits non-zero on 100% packet loss but still writes useful
    // output to stdout — surface that instead of just "command failed".
    out = err.stdout || "";
    if (!out) throw new Error(err.message);
  }
  const lossMatch = out.match(/(\d+(?:\.\d+)?)% packet loss/);
  const rttMatch = out.match(/= ([\d.]+)\/([\d.]+)\/([\d.]+)\/([\d.]+)/);
  return {
    host: target,
    raw: out.trim(),
    packetLossPercent: lossMatch ? Number(lossMatch[1]) : null,
    rttMs: rttMatch
      ? { min: Number(rttMatch[1]), avg: Number(rttMatch[2]), max: Number(rttMatch[3]), mdev: Number(rttMatch[4]) }
      : null,
  };
}

// --- DNS lookup --------------------------------------------------------------

async function dnsLookup(host) {
  const target = assertValidHost(host);
  const isIp = net.isIP(target) !== 0;

  if (isIp) {
    const hostnames = await dns.promises.reverse(target).catch(() => []);
    return { query: target, type: "PTR", hostnames };
  }

  const [a, aaaa, mx, txt, cname] = await Promise.all([
    dns.promises.resolve4(target).catch(() => []),
    dns.promises.resolve6(target).catch(() => []),
    dns.promises.resolveMx(target).catch(() => []),
    dns.promises.resolveTxt(target).catch(() => []),
    dns.promises.resolveCname(target).catch(() => []),
  ]);
  return { query: target, a, aaaa, mx, txt: txt.map((t) => t.join("")), cname };
}

// --- traceroute (via tracepath — no root required) --------------------------

function tracerouteHost(host, maxHops) {
  const target = assertValidHost(host);
  if (!commandAvailable("tracepath")) {
    throw new Error("tracepath is not installed on the tools-agent host");
  }
  const hops = Math.min(Math.max(Number(maxHops) || 20, 1), MAX_TRACEROUTE_HOPS);
  let out;
  try {
    out = execFileSync("tracepath", ["-m", String(hops), target], {
      encoding: "utf8",
      timeout: TRACEROUTE_TIMEOUT_MS,
    });
  } catch (err) {
    out = err.stdout || "";
    if (!out) throw new Error(err.message);
  }
  const hopLines = out
    .trim()
    .split("\n")
    .filter((l) => /^\s*\d+[?:]/.test(l))
    .map((l) => l.trim());
  return { host: target, hops: hopLines, raw: out.trim() };
}

// --- whois -------------------------------------------------------------------

function whoisLookup(query) {
  const target = assertValidHost(query);
  if (!commandAvailable("whois")) {
    throw new Error("whois is not installed on the tools-agent host");
  }
  const out = execFileSync("whois", [target], {
    encoding: "utf8",
    timeout: WHOIS_TIMEOUT_MS,
    maxBuffer: 2 * 1024 * 1024,
  });
  // Whois records vary wildly by registrar; just trim obvious legal
  // boilerplate/blank padding and cap length rather than trying to
  // parse every registrar's format.
  const trimmed = out
    .split("\n")
    .filter((l) => !/^%|^#/.test(l.trim()))
    .join("\n")
    .trim();
  return { query: target, raw: trimmed.slice(0, 8000) };
}

// --- port scan (plain TCP connect scan, no nmap dependency) -----------------

function parsePortList(portsArg) {
  const ports = new Set();
  const raw = String(portsArg || "").trim();
  if (!raw) return [80, 443, 22, 21, 25, 3306, 5432, 6379, 8080, 8443];
  for (const part of raw.split(",")) {
    const p = part.trim();
    const rangeMatch = p.match(/^(\d+)-(\d+)$/);
    if (rangeMatch) {
      const start = Number(rangeMatch[1]);
      const end = Number(rangeMatch[2]);
      for (let i = start; i <= end; i++) ports.add(i);
    } else if (/^\d+$/.test(p)) {
      ports.add(Number(p));
    }
  }
  return [...ports].filter((p) => p >= 1 && p <= 65535);
}

function checkPort(host, port) {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    let settled = false;
    const finish = (state) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve({ port, state });
    };
    socket.setTimeout(PORT_SCAN_CONNECT_TIMEOUT_MS);
    socket.once("connect", () => finish("open"));
    socket.once("timeout", () => finish("filtered"));
    socket.once("error", () => finish("closed"));
    socket.connect(port, host);
  });
}

async function portScan(host, portsArg) {
  const target = assertValidHost(host);
  let ports = parsePortList(portsArg);
  if (ports.length > MAX_PORT_SCAN_PORTS) {
    throw new Error(`too many ports requested (max ${MAX_PORT_SCAN_PORTS})`);
  }
  const results = [];
  for (let i = 0; i < ports.length; i += PORT_SCAN_CONCURRENCY) {
    const batch = ports.slice(i, i + PORT_SCAN_CONCURRENCY);
    const batchResults = await Promise.all(batch.map((p) => checkPort(target, p)));
    results.push(...batchResults);
  }
  results.sort((a, b) => a.port - b.port);
  return {
    host: target,
    scanned: results.length,
    open: results.filter((r) => r.state === "open").map((r) => r.port),
    results,
  };
}

function registerRoutes(router) {
  router.any("/ping", (req, res, url) => {
    const host = url.searchParams.get("host") || "";
    const count = url.searchParams.get("count");
    try {
      return send(res, 200, pingHost(host, count));
    } catch (err) {
      return send(res, 400, { error: err.message });
    }
  });

  router.any("/dns-lookup", (req, res, url) => {
    const host = url.searchParams.get("host") || "";
    return dnsLookup(host)
      .then((result) => send(res, 200, result))
      .catch((err) => send(res, 400, { error: err.message }));
  });

  router.any("/traceroute", (req, res, url) => {
    const host = url.searchParams.get("host") || "";
    const maxHops = url.searchParams.get("maxHops");
    try {
      return send(res, 200, tracerouteHost(host, maxHops));
    } catch (err) {
      return send(res, 400, { error: err.message });
    }
  });

  router.any("/whois", (req, res, url) => {
    const query = url.searchParams.get("query") || "";
    try {
      return send(res, 200, whoisLookup(query));
    } catch (err) {
      return send(res, 400, { error: err.message });
    }
  });

  router.any("/port-scan", (req, res, url) => {
    const host = url.searchParams.get("host") || "";
    const ports = url.searchParams.get("ports") || "";
    return portScan(host, ports)
      .then((result) => send(res, 200, result))
      .catch((err) => send(res, 400, { error: err.message }));
  });
}

module.exports = {
  pingHost,
  dnsLookup,
  tracerouteHost,
  whoisLookup,
  portScan,
  registerRoutes,
};
