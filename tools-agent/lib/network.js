"use strict";

// Network diagnostic tools (ping/dns/traceroute/whois/port-scan/lan-scan/
// speed-test). The actual tool logic lives in the shared assistant-tools
// submodule (see tools-agent/shared/README.md) — this file just adapts it
// to Lain's own HTTP conventions so it can be kept in sync with other
// projects (e.g. Asuna) that use the same tools.
const networkTool = require("../shared/tools/network");
const { send } = require("./http");

function registerRoutes(router) {
  networkTool.registerRoutes(router, { send });
}

module.exports = { registerRoutes, ...networkTool };
