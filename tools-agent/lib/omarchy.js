"use strict";

// Omarchy theme/status/command tools. The actual logic lives in the
// shared assistant-tools submodule (see tools-agent/shared/README.md) —
// this file just injects Lain's own HTTP and filesystem-sandboxing
// helpers.
const omarchyTool = require("../shared/tools/omarchy");
const { send, readJsonBody } = require("./http");
const { resolveInputPath, isAllowed } = require("./paths");

function registerRoutes(router) {
  omarchyTool.registerRoutes(router, { send, readJsonBody, resolveInputPath, isAllowed });
}

// Auto-inject Lain's path helpers so direct calls (not just HTTP routes)
// don't need to pass them every time.
function omarchyCreateTheme(args) {
  return omarchyTool.omarchyCreateTheme(args, { resolveInputPath, isAllowed });
}

function omarchyCreateThemeFromImage(args) {
  return omarchyTool.omarchyCreateThemeFromImage(args, { resolveInputPath, isAllowed });
}

module.exports = { ...omarchyTool, registerRoutes, omarchyCreateTheme, omarchyCreateThemeFromImage };
