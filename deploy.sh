#!/usr/bin/env bash
# Builds and starts Lain locally via docker compose. Lain is local-only —
# there is no remote server; this always runs on the current machine.
set -euo pipefail

cd "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

if [[ ! -f .env ]]; then
  cp .env.example .env
  echo "⚠️  Created .env from .env.example — edit it with real secrets, then re-run ./deploy.sh"
  exit 1
fi

echo "==> Building and starting Lain via docker compose (local)"
docker compose up -d --build

echo "==> Done. Check .env's LAIN_HOST_PORT for the actual port (default 3000)."
