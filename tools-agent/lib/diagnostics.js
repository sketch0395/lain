"use strict";

// system_diagnostics tool. The actual logic lives in the shared
// assistant-tools submodule (see tools-agent/shared/README.md) — this
// file just adapts it to Lain's own HTTP conventions.
const diagnosticsTool = require("../shared/tools/diagnostics");
const { send } = require("./http");

function registerRoutes(router) {
  diagnosticsTool.registerRoutes(router, { send });
}

module.exports = { registerRoutes, diagnostics: diagnosticsTool.diagnostics };
