"use strict";

// Self-update tool (update_lain). The actual logic lives in the shared
// assistant-tools submodule (see tools-agent/shared/README.md) — this
// file just injects Lain's own repo dir, product name, and HTTP helpers.
const updateTool = require("../shared/tools/update");
const { REPO_DIR } = require("./config");
const { send } = require("./http");

function requireRepoDir() {
  return updateTool.requireRepoDir(REPO_DIR, "LAIN_REPO_DIR");
}

function startUpdate() {
  return updateTool.startUpdate({ repoDir: REPO_DIR, repoDirEnvVar: "LAIN_REPO_DIR", productName: "Lain" });
}

function registerRoutes(router) {
  updateTool.registerRoutes(router, {
    repoDir: REPO_DIR,
    repoDirEnvVar: "LAIN_REPO_DIR",
    productName: "Lain",
    send,
  });
}

module.exports = { requireRepoDir, startUpdate, registerRoutes };
