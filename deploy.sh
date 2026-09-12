#!/usr/bin/env bash
# Deploys Lain to the home lab server over SSH and starts it with docker compose.
set -euo pipefail

SERVER_USER="${LAIN_SSH_USER:-dialtone}"
SERVER_HOST="${LAIN_SSH_HOST:-10.5.1.17}"
SERVER_PORT="${LAIN_SSH_PORT:-22}"
REMOTE_DIR="${LAIN_REMOTE_DIR:-~/lain}"

echo "==> Syncing project files to ${SERVER_USER}@${SERVER_HOST}:${REMOTE_DIR}"
# .env / .env.local (and *.local variants) are intentionally excluded: the
# server's .env holds the live production secrets (AUTH_SECRET, OAuth
# credentials, allowlist) and must be managed directly on the server, never
# overwritten (or deleted, via --delete) by whatever does or doesn't exist
# locally. .env.example has no secrets and IS synced, so the template on the
# server always reflects the latest config options.
rsync -az --delete \
  --exclude 'node_modules' \
  --exclude '.next' \
  --exclude '.git' \
  --exclude 'data' \
  --exclude '.env' \
  --exclude '.env.local' \
  --exclude '.env.*.local' \
  -e "ssh -p ${SERVER_PORT}" \
  ./ "${SERVER_USER}@${SERVER_HOST}:${REMOTE_DIR}/"

echo "==> Building and starting Lain via docker compose on the server"
ssh -p "${SERVER_PORT}" "${SERVER_USER}@${SERVER_HOST}" \
  "cd ${REMOTE_DIR} && if [ ! -f .env ]; then cp .env.example .env; echo '⚠️  Created .env from .env.example on the server — edit it with real secrets, then re-run ./deploy.sh'; fi && docker compose up -d --build"

echo "==> Done. Check .env's LAIN_HOST_PORT on the server for the actual port (default 3000)."
