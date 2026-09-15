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

# --- Docker daemon check ------------------------------------------------
# deploy.sh can be run standalone (without install.sh), e.g. if Docker was
# already installed manually but isn't currently running — make sure it's
# up before handing off to `docker compose`, instead of failing with a
# confusing "Cannot connect to the Docker daemon" error.
docker_running() {
  if command -v systemctl >/dev/null 2>&1 && systemctl list-unit-files docker.service >/dev/null 2>&1; then
    systemctl is-active --quiet docker
  else
    docker info >/dev/null 2>&1
  fi
}

if ! command -v docker >/dev/null 2>&1; then
  echo "error: docker not found — install it first (see install.sh or" >&2
  echo "  https://docs.docker.com/engine/install/), then re-run." >&2
  exit 1
fi

if ! docker_running; then
  echo "==> Docker isn't running — starting it..."
  if command -v systemctl >/dev/null 2>&1 && systemctl list-unit-files docker.service >/dev/null 2>&1; then
    sudo systemctl start docker
  elif command -v service >/dev/null 2>&1; then
    sudo service docker start
  else
    echo "error: couldn't find a way to start Docker on this system — start" >&2
    echo "  it manually, then re-run." >&2
    exit 1
  fi
  for _ in $(seq 1 10); do
    docker_running && break
    sleep 1
  done
  if ! docker_running; then
    echo "error: Docker still isn't responding after starting it — check" >&2
    echo "  'sudo systemctl status docker' (or your distro's equivalent)." >&2
    exit 1
  fi
  echo "==> Docker is now running."
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

# --- Shodan.io integration (optional) ---
# Offers to set this up on a fresh install the same way the tools agent is
# offered above, so the feature is discoverable instead of silently unused
# because nobody knew to add SHODAN_API_KEY to .env themselves.
shodan_configured() {
  grep -qE '^SHODAN_API_KEY=\S+' .env 2>/dev/null
}

if ! shodan_configured; then
  if [[ "${LAIN_SKIP_SHODAN_SETUP:-}" == "true" ]]; then
    : # explicitly opted out, skip silently
  elif [[ -t 0 ]]; then
    echo
    echo "Lain can optionally look up what's publicly exposed on an IP/domain"
    echo "via Shodan.io (shodan_host_lookup/shodan_search/etc) when you ask."
    echo "Get a free or paid API key at https://account.shodan.io/"
    read -rp "Enter a Shodan API key now to enable this? (blank to skip) " shodan_key
    if [[ -n "$shodan_key" ]]; then
      set_env_var SHODAN_API_KEY "$shodan_key"
      echo "==> Wired up SHODAN_API_KEY in .env"
    else
      echo "==> Skipping — add SHODAN_API_KEY to .env any time to enable it later."
    fi
  else
    echo "==> Shodan integration not configured and no terminal to prompt (non-interactive run)."
    echo "    Add SHODAN_API_KEY to .env, then re-run ./deploy.sh to enable it."
    echo "    Set LAIN_SKIP_SHODAN_SETUP=true to silence this message."
  fi
fi

echo "==> Building and starting Lain via docker compose (local)"
export GIT_COMMIT="$(git rev-parse HEAD 2>/dev/null || echo unknown)"
docker compose up -d --build

echo "==> Done. Check .env's LAIN_HOST_PORT for the actual port (default 3000)."
