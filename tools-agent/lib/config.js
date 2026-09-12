"use strict";

// Central config/constants for the tools agent, read once at startup.
// Everything here is derived from environment variables set by
// scripts/setup-tools-agent.sh's systemd --user unit (see
// ~/.config/lain/tools-agent.env).

const os = require("node:os");
const path = require("node:path");

const OMARCHY_STATE_DIR = path.join(os.homedir(), ".local/state/omarchy/current");

const PORT = Number(process.env.LAIN_TOOLS_PORT || 8787);
const TOKEN = process.env.LAIN_TOOLS_TOKEN || "";

// Where the Lain git repo lives on disk — used only by update.js (kicking
// off scripts/update.sh). Not an allowed filesystem root itself; that
// module is the only one that touches it, via a fixed script path.
const REPO_DIR = process.env.LAIN_REPO_DIR || "";

const ALLOWED_ROOTS = (process.env.LAIN_TOOLS_ALLOWED_ROOTS || os.homedir())
  .split(",")
  .map((p) => p.trim())
  .filter(Boolean)
  .map((p) => path.resolve(p));

const DENY_PATTERNS = [
  /(^|\/)\.ssh(\/|$)/i,
  /(^|\/)\.gnupg(\/|$)/i,
  /(^|\/)\.config\/lain(\/|$)/i,
  /(^|\/)\.aws(\/|$)/i,
  /(^|\/)\.docker\/config\.json$/i,
  /(^|\/)\.env(\..*)?$/i,
  /id_rsa/i,
  /id_ed25519/i,
  /\.pem$/i,
  /\.key$/i,
  /(^|\/)\.gitconfig$/i,
];

const SKIP_DIRS = new Set([
  "node_modules",
  ".git",
  ".cache",
  "dist",
  "build",
  ".next",
  ".venv",
  "venv",
  "__pycache__",
]);

const MAX_FILE_SCAN_BYTES = 1_500_000; // skip large/binary-ish files in search
const DEFAULT_WALK_TIMEOUT_MS = 4000;
const DEFAULT_WALK_MAX_ENTRIES = 20000;

// Extensions we know are binary/non-text — skip these outright when
// batch-reading a directory for summarization (no point trying to decode
// a PDF/image/archive as UTF-8 text).
const BINARY_EXTENSIONS = new Set([
  ".pdf", ".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp", ".ico", ".svg",
  ".zip", ".tar", ".gz", ".xz", ".7z", ".rar",
  ".mp3", ".mp4", ".mov", ".avi", ".mkv", ".wav", ".flac",
  ".exe", ".bin", ".iso", ".dmg", ".appimage",
  ".doc", ".docx", ".xls", ".xlsx", ".ppt", ".pptx",
  ".woff", ".woff2", ".ttf", ".otf",
]);

module.exports = {
  OMARCHY_STATE_DIR,
  PORT,
  TOKEN,
  REPO_DIR,
  ALLOWED_ROOTS,
  DENY_PATTERNS,
  SKIP_DIRS,
  MAX_FILE_SCAN_BYTES,
  DEFAULT_WALK_TIMEOUT_MS,
  DEFAULT_WALK_MAX_ENTRIES,
  BINARY_EXTENSIONS,
};
