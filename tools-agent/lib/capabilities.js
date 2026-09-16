"use strict";

// Internal privilege-elevation endpoint (grant tcpdump capture
// capability) — not an LLM-callable tool. The actual logic lives in the
// shared assistant-tools submodule (see tools-agent/shared/README.md) —
// this file just injects Lain's own HTTP helpers.
const capabilitiesTool = require("../shared/tools/capabilities");
const { send, readJsonBody } = require("./http");

function registerRoutes(router) {
  capabilitiesTool.registerRoutes(router, { send, readJsonBody });
}

module.exports = { ...capabilitiesTool, registerRoutes };
