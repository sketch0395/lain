"use strict";

// find_files/search_files/read_file/list_directory/summarize_directory:
// read-only filesystem browsing tools. The actual tool logic lives in the
// shared assistant-tools submodule (see tools-agent/shared/README.md) —
// this file just adapts it to Lain's own config/http conventions so it
// can be kept in sync with other projects (e.g. Asuna) that use the same
// tools.
const filesTool = require("../shared/tools/files");
const {
  SKIP_DIRS,
  MAX_FILE_SCAN_BYTES,
  BINARY_EXTENSIONS,
  ALLOWED_ROOTS,
} = require("./config");
const { resolveInputPath, isAllowed, looksBinary, walk } = require("./paths");
const { send } = require("./http");

function registerRoutes(router) {
  filesTool.registerRoutes(router, {
    allowedRoots: ALLOWED_ROOTS,
    isAllowed,
    resolveAllowedPath: resolveInputPath,
    walk,
    looksBinary,
    skipDirs: SKIP_DIRS,
    binaryExtensions: BINARY_EXTENSIONS,
    maxFileScanBytes: MAX_FILE_SCAN_BYTES,
    send,
  });
}

module.exports = {
  registerRoutes,
  findFiles: filesTool.findFiles,
  searchFiles: filesTool.searchFiles,
  listDirectory: filesTool.listDirectory,
  readDirectory: filesTool.readDirectory,
  readFileSafe: filesTool.readFileSafe,
};
