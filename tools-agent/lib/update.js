"use strict";

const os = require("node:os");
const fs = require("node:fs");
const path = require("node:path");
const { spawn } = require("node:child_process");
const { REPO_DIR } = require("./config");
const { send } = require("./http");

function requireRepoDir() {
  if (!REPO_DIR) {
    throw new Error(
      "LAIN_REPO_DIR is not configured on the tools agent — re-run " +
        "scripts/setup-tools-agent.sh to set it."
    );
  }
  if (!fs.existsSync(path.join(REPO_DIR, ".git"))) {
    throw new Error(`LAIN_REPO_DIR (${REPO_DIR}) doesn't look like a git repo.`);
  }
}

// Kicks off scripts/update.sh (git pull + resync tools agent + rebuild/
// restart the Lain container) as a detached background process, so it can
// finish restarting lain-tools-agent itself without killing this HTTP
// response mid-flight. Progress is written to a log file the caller can
// mention, but we don't wait around to tail it. (Checking *whether* an
// update is available happens separately, straight from the Lain app via
// the public GitHub API — see lib/version.js in the main app — so it
// works without this agent at all; this endpoint only applies one.)
function startUpdate() {
  requireRepoDir();
  const scriptPath = path.join(REPO_DIR, "scripts", "update.sh");
  if (!fs.existsSync(scriptPath)) {
    throw new Error("scripts/update.sh not found in the repo — pull the latest changes first.");
  }
  const logPath = path.join(os.tmpdir(), `lain-update-${Date.now()}.log`);
  const logFd = fs.openSync(logPath, "a");
  const child = spawn("bash", [scriptPath], {
    cwd: REPO_DIR,
    detached: true,
    stdio: ["ignore", logFd, logFd],
  });
  child.unref();
  return { started: true, logFile: logPath };
}

function registerRoutes(router) {
  router.post("/update", (req, res) => send(res, 200, startUpdate()));
}

module.exports = { requireRepoDir, startUpdate, registerRoutes };
