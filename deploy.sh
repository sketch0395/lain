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

# --- Tools agent (diagnostics/files/Omarchy access) -------------------------
# Offers to set this up on a fresh install so Lain's tool features actually
# work out of the box, instead of silently staying disabled because nobody
# ran scripts/setup-tools-agent.sh separately.
tools_configured() {
  grep -qE '^LAIN_TOOLS_URL=\S+' .env 2>/dev/null && grep -qE '^LAIN_TOOLS_TOKEN=\S+' .env 2>/dev/null
}

set_env_var() {
  local key="$1" value="$2"
  if grep -qE "^${key}=" .env; then
    sed -i "s#^${key}=.*#${key}=${value}#" .env
  else
    printf '%s=%s\n' "$key" "$value" >> .env
  fi
}

if ! tools_configured; then
  agent_env="$HOME/.config/lain/tools-agent.env"
  already_installed="false"
  [[ -f "$agent_env" ]] && already_installed="true"

  setup_now="false"
  if [[ "${LAIN_SKIP_TOOLS_SETUP:-}" == "true" ]]; then
    : # explicitly opted out, skip silently
  elif [[ "$already_installed" == "true" ]]; then
    setup_now="true" # agent already installed, just wire up .env below
  elif [[ -t 0 ]]; then
    echo
    echo "Lain can optionally check system diagnostics, files, and your"
    echo "Omarchy theme when you ask her to — this needs a small local agent"
    echo "(scripts/setup-tools-agent.sh)."
    read -rp "Set it up now? [Y/n] " reply
    if [[ ! "$reply" =~ ^[Nn] ]]; then
      ./scripts/setup-tools-agent.sh
      setup_now="true"
    else
      echo "==> Skipping — run ./scripts/setup-tools-agent.sh any time to enable it later."
    fi
  else
    echo "==> Tools agent not configured and no terminal to prompt (non-interactive run)."
    echo "    Run ./scripts/setup-tools-agent.sh, then re-run ./deploy.sh to enable it."
    echo "    Set LAIN_SKIP_TOOLS_SETUP=true to silence this message."
  fi

  if [[ "$setup_now" == "true" && -f "$agent_env" ]]; then
    # shellcheck disable=SC1090
    source "$agent_env"
    lan_ip="$(ip -4 -o addr show scope global 2>/dev/null | awk '{print $4}' | cut -d/ -f1 | grep -vE '^172\.(1[7-9]|2[0-9]|3[0-1])\.' | head -1)"
    lan_ip="${lan_ip:-127.0.0.1}"
    set_env_var LAIN_TOOLS_URL "http://${lan_ip}:${LAIN_TOOLS_PORT:-8787}"
    set_env_var LAIN_TOOLS_TOKEN "${LAIN_TOOLS_TOKEN:-}"
    echo "==> Wired up LAIN_TOOLS_URL/LAIN_TOOLS_TOKEN in .env"
  fi
fi

echo "==> Building and starting Lain via docker compose (local)"
export GIT_COMMIT="$(git rev-parse HEAD 2>/dev/null || echo unknown)"
docker compose up -d --build

echo "==> Done. Check .env's LAIN_HOST_PORT for the actual port (default 3000)."
