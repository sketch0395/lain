"use strict";

// Digital-forensics-style tools (hash/metadata/strings/pcap/processes/
// connections/logs/login-history/packet-capture). The actual logic lives
// in the shared assistant-tools submodule (see
// tools-agent/shared/README.md) — this file just injects Lain's own
// filesystem-sandboxing, HTTP, and notify helpers.
const forensicsTool = require("../shared/tools/forensics");
const { ALLOWED_ROOTS } = require("./config");
const { resolveInputPath, isAllowed, walk } = require("./paths");
const { send, readJsonBody } = require("./http");
const { notify } = require("./notify");

function registerRoutes(router) {
  forensicsTool.registerRoutes(router, {
    resolveInputPath,
    isAllowed,
    walk,
    defaultRoot: ALLOWED_ROOTS[0],
    send,
    readJsonBody,
    notify,
  });
}

module.exports = { ...forensicsTool, registerRoutes };
