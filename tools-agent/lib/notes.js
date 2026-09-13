"use strict";

// create_note: writes/appends/replaces markdown (.md) note files under
// NOTES_DIR (defaults to ~/Documents, configurable via
// LAIN_TOOLS_NOTES_DIR). The actual tool logic lives in the shared
// assistant-tools submodule (see tools-agent/shared/README.md) — this
// file just adapts it to Lain's own config/http conventions so it can be
// kept in sync with other projects (e.g. Asuna) that use the same tool.
const notesTool = require("../shared/tools/notes");
const { NOTES_DIR } = require("./config");
const { isAllowed } = require("./paths");
const { send, readJsonBody } = require("./http");

function registerRoutes(router) {
  notesTool.registerRoutes(router, {
    notesDir: NOTES_DIR,
    isAllowed,
    send,
    readJsonBody,
    author: "Lain",
  });
}

module.exports = { registerRoutes, createNote: notesTool.createNote };
