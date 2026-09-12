#!/usr/bin/env bash
# Pulls the latest Lain changes and brings everything back up: resyncs the
# tools agent (if installed) and rebuilds/restarts the main container.
#
# Called two ways:
#   - Directly: ./scripts/update.sh
#   - By the tools agent's update_lain tool (via chat), which spawns this
#     detached so it can survive lain-tools-agent restarting itself.
#
# Safe to re-run; exits early with "Already up to date" if there's nothing
# to pull. Uses --ff-only so it never silently merges/rebases over local
# changes — if that fails, it's a sign this checkout was modified by hand
# and needs manual attention.

set -euo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_DIR"

log() { echo "==> $*"; }

log "Fetching latest changes..."
git fetch --quiet

LOCAL="$(git rev-parse HEAD)"
REMOTE="$(git rev-parse '@{u}' 2>/dev/null || true)"

if [[ -z "$REMOTE" ]]; then
  echo "error: no upstream tracking branch configured for this checkout." >&2
  exit 1
fi

if [[ "$LOCAL" == "$REMOTE" ]]; then
  log "Already up to date ($(git rev-parse --short HEAD))."
  exit 0
fi

log "Pulling latest changes (fast-forward only)..."
if ! git pull --ff-only; then
  echo "error: fast-forward pull failed — this checkout likely has local" >&2
  echo "  changes or diverged history. Resolve manually with 'git status'" >&2
  echo "  / 'git log' in $REPO_DIR, then re-run this script." >&2
  exit 1
fi
log "Now at $(git rev-parse --short HEAD)."

if systemctl --user list-unit-files lain-tools-agent.service >/dev/null 2>&1; then
  log "Resyncing tools agent..."
  mkdir -p "$HOME/.local/share/lain"
  cp "$REPO_DIR/tools-agent/server.js" "$HOME/.local/share/lain/tools-agent.js"
  # Restarting kills this script's own parent process group if it was
  # spawned by the tools agent — that's fine, we're detached and keep
  # running independently to finish the job below.
  systemctl --user restart lain-tools-agent || true
fi

log "Rebuilding and restarting Lain..."
./deploy.sh

log "Update complete — now at $(git rev-parse --short HEAD)."
