"use strict";

const { execFileSync } = require("node:child_process");
const { send, readJsonBody } = require("./http");

function notify(title, body) {
  // Best-effort desktop notification via notify-send. Fixed binary, args are
  // passed as separate execFile arguments (no shell), so there's no
  // injection risk even though title/body come from Lain's reminders.
  execFileSync("notify-send", ["--app-name=Lain", title || "Lain", body || ""], {
    timeout: 5000,
  });
}

function registerRoutes(router) {
  router.post("/notify", async (req, res) => {
    try {
      const { title, body } = await readJsonBody(req);
      notify(title, body);
      send(res, 200, { ok: true });
    } catch (err) {
      send(res, 500, { error: err.message });
    }
  });
}

module.exports = { notify, registerRoutes };
