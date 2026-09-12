"use strict";

const os = require("node:os");
const { execFileSync } = require("node:child_process");
const { send } = require("./http");

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

function registerRoutes(router) {
  router.any("/diagnostics", (req, res) => send(res, 200, diagnostics()));
}

module.exports = { diagnostics, registerRoutes };
