#!/usr/bin/env node
"use strict";

// lain-tools-agent — a small, read-only, token-authenticated HTTP service
// that runs on the user's laptop and lets Lain check system diagnostics,
// look at files (strictly within directories the user has allowed),
// read/change the Omarchy desktop (current theme, active window/workspace),
// do basic digital-forensics-style investigation (file hashing/metadata,
// string extraction, process/connection snapshots, log search, login
// history, live/offline packet capture, and pcap summaries), and apply
// Lain updates (git pull + rebuild/restart) — the only tool here that
// touches anything outside the sandboxed Docker container. Checking
// *whether* an update is available happens separately, straight from the
// Lain app via the public GitHub API (see lib/version.js in the main
// app), so that part works without this agent too.
//
// See ../TOOLS.md for the full endpoint-by-endpoint reference and which
// LLM-facing tool (defined in lib/tools.js) calls each one.
//
// This file is just the HTTP entrypoint — each group of tools lives in its
// own module under lib/ (config, path/sandboxing helpers, and one file per
// tool domain: diagnostics, omarchy, files, forensics, notify, notes,
// update, capabilities), and registers its own routes via the tiny router
// in lib/http.js.
//
// Security model:
//   - Every request (except /health) requires a bearer token, compared
//     with a constant-time check (lib/http.js's checkAuth).
//   - Mostly read-only. The exceptions that change anything on the
//     laptop are `notify-send` (reminder notifications), `omarchy-theme-set`
//     (theme switching, only after validating the requested name against
//     the actual installed theme list), create_note (writes/appends .md
//     files, but only inside LAIN_TOOLS_NOTES_DIR, sandboxed the same as
//     every other filesystem access), and a single, fixed `setcap`
//     invocation used solely to grant tcpdump packet-capture permissions
//     (lib/capabilities.js — not an LLM tool; only reachable from a
//     dedicated, non-chat password prompt in the main app, so a user's
//     sudo password never enters the model's context or conversation
//     history) — none of these can write/delete/read arbitrary files, and
//     all run via execFile with fixed binaries and argument arrays (no
//     shell involved). Every forensics command is likewise a fixed binary
//     with a fixed or validated argument array — no shell, no string
//     interpolation.
//   - Filesystem access is restricted to LAIN_TOOLS_ALLOWED_ROOTS
//     (resolved to real, absolute paths) and further blocked from a
//     denylist of sensitive paths (SSH/GPG keys, .env files, etc.) even if
//     they happen to live inside an allowed root (lib/paths.js). This
//     applies to every tool that takes a file/directory path.
//   - System-wide tools (list_processes, network_connections, search_logs,
//     login_history) aren't path-restricted since they don't read
//     arbitrary files — they only report what the agent's own OS user can
//     already see (no privilege escalation; e.g. `ss`/`ps` show only this
//     user's own sockets/processes unless already running as root).
//   - Refuses to start at all if LAIN_TOOLS_TOKEN isn't set.
//
// Install/run via scripts/setup-tools-agent.sh, which sets this up as a
// systemd --user service.

const http = require("node:http");
const { PORT, TOKEN, ALLOWED_ROOTS } = require("./lib/config");
const { checkAuth, send, createRouter } = require("./lib/http");

const router = createRouter();
require("./lib/diagnostics").registerRoutes(router);
require("./lib/omarchy").registerRoutes(router);
require("./lib/files").registerRoutes(router);
require("./lib/forensics").registerRoutes(router);
require("./lib/network").registerRoutes(router);
require("./lib/notify").registerRoutes(router);
require("./lib/notes").registerRoutes(router);
require("./lib/update").registerRoutes(router);
require("./lib/capabilities").registerRoutes(router);

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);

  // /health is allowed without auth solely so a load balancer or `curl`
  // can sanity-check the process is up; it reveals nothing sensitive.
  if (url.pathname === "/health" && req.method === "GET") {
    return send(res, 200, { ok: true });
  }

  if (!checkAuth(req)) return send(res, 401, { error: "unauthorized" });

  const handled = router.handle(req, res, url);
  if (!handled) return send(res, 404, { error: "not found" });
});

if (!TOKEN) {
  console.error(
    "lain-tools-agent: LAIN_TOOLS_TOKEN is not set — refusing to start " +
      "(this would allow unauthenticated access to your filesystem)."
  );
  process.exit(1);
}

server.listen(PORT, () => {
  console.log(
    `lain-tools-agent listening on :${PORT}, allowed roots: ${ALLOWED_ROOTS.join(", ")}`
  );
});
