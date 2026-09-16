"use strict";

// Desktop notification tool (used internally, e.g. by reminders — not an
// LLM-callable tool itself). The actual logic lives in the shared
// assistant-tools submodule (see tools-agent/shared/README.md) — this
// file just adapts it to Lain's own HTTP conventions and app name.
const notifyTool = require("../shared/tools/notify");
const { send, readJsonBody } = require("./http");

function registerRoutes(router) {
  notifyTool.registerRoutes(router, { send, readJsonBody, appName: "Lain" });
}

function notify(title, body) {
  return notifyTool.notify(title, body, "Lain");
}

module.exports = { registerRoutes, notify };
