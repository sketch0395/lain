// Barrel re-export: the actual implementation now lives in lib/tools/,
// split into one file per tool category (core, network, forensics,
// omarchy, cyberIntel, systemUpdate) plus a shared HTTP client and a
// registry that assembles them — see lib/tools/registry.js. This file
// exists only so the 5 existing importers (app/api/chat/route.js,
// app/api/chat/confirm/route.js, app/api/health/route.js, lib/notify.js,
// lib/ollama.js) don't need their import paths changed.
//
// See ../TOOLS.md for a full reference table of every tool defined here
// (name, params, implementation, and — for laptop tools — which
// tools-agent/lib/*.js module + HTTP endpoint it calls). Keep that file
// in sync when adding/changing a tool.

export * from "./tools/registry";
