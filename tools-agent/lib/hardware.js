"use strict";

// get_system_info / can_run_model tools. The actual logic lives in the
// shared assistant-tools submodule (see tools-agent/shared/README.md) —
// this file just adapts it to Lain's own HTTP conventions.
const hardwareTool = require("../shared/tools/hardware");
const { send } = require("./http");

function registerRoutes(router) {
  hardwareTool.registerRoutes(router, { send });
}

module.exports = { registerRoutes };
