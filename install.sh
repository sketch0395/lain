#!/usr/bin/env bash
# One-shot setup for a fresh Omarchy machine — installs/configures
# everything Lain needs and brings her up, so a new user only has to run
# this single script (plus create an OAuth app, which can't be automated).
#
# What it does, in order:
#   1. Docker + docker-compose-plugin (installs via pacman if missing,
#      enables the service, adds you to the `docker` group).
#   2. Ollama (installs via the official install script if missing, makes
#      sure it's listening on all interfaces so the Docker container can
#      reach it, pulls the default + deep-thinking models).
#   3. .env (creates it from .env.example + a generated AUTH_SECRET if
#      missing, then pauses for you to fill in OAuth credentials — that
#      part genuinely can't be scripted).
#   4. Optional: the `lain` CLI + Hyprland keybinding
#      (scripts/setup-omarchy-cli.sh).
#   5. Builds and starts Lain (./deploy.sh), which itself offers to set up
#      the optional tools agent (diagnostics/files/Omarchy/forensics) if
#      not already configured.
#
# Safe to re-run any time — every step checks whether it's already done
# before doing anything.
#
# Usage:
#   ./install.sh                  # interactive
#   ./install.sh --non-interactive   # skip all prompts, use defaults/skip
#
# Env overrides (all optional):
#   LAIN_SKIP_CLI_SETUP=true      skip the CLI/keybind prompt entirely
#   LAIN_SKIP_TOOLS_SETUP=true    passed through to deploy.sh

set -euo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$REPO_DIR"

# Pull in the shared tools submodule (tools-agent/shared) if it's missing
# or empty — needed for tools like create_note. Harmless no-op if already
# initialized, and safe to skip if this isn't a git checkout (e.g. a
# tarball) or there's no network access.
if [[ -f .gitmodules ]] && command -v git >/dev/null 2>&1; then
  git submodule update --init --recursive 2>/dev/null || true
fi

non_interactive="false"
for arg in "$@"; do
  case "$arg" in
    --non-interactive) non_interactive="true" ;;
  esac
done

log() { echo "==> $*"; }
have() { command -v "$1" >/dev/null 2>&1; }

confirm() {
  # confirm "prompt" — returns 0 (yes) by default, or always "yes" when
  # non-interactive/no tty (so this script never hangs in automation).
  local prompt="$1" reply
  if [[ "$non_interactive" == "true" || ! -t 0 ]]; then
    return 0
  fi
  read -r -p "$prompt [Y/n] " reply
  [[ ! "$reply" =~ ^[Nn] ]]
}

echo
echo "###############################################"
echo "#  Lain — one-shot setup                     #"
echo "###############################################"
echo

# -----------------------------------------------------------------------
# 1. Docker
# -----------------------------------------------------------------------
log "Checking Docker..."
if ! have docker; then
  if have pacman; then
    log "Installing docker + docker-compose-plugin via pacman..."
    sudo pacman -S --needed --noconfirm docker docker-compose-plugin
  elif have apt-get; then
    log "Installing docker + docker-compose-plugin via apt..."
    sudo apt-get update
    sudo apt-get install -y ca-certificates curl
    # Prefer the distro's own docker.io/docker-compose-v2 packages (Ubuntu
    # 24.04+ ships a recent enough Docker); fall back to Docker's official
    # apt repo if those aren't available (e.g. older Ubuntu releases).
    if sudo apt-get install -y docker.io docker-compose-v2 2>/dev/null; then
      :
    else
      log "distro docker packages unavailable — adding Docker's official apt repo..."
      sudo install -m 0755 -d /etc/apt/keyrings
      . /etc/os-release
      sudo curl -fsSL "https://download.docker.com/linux/${ID}/gpg" -o /etc/apt/keyrings/docker.asc
      sudo chmod a+r /etc/apt/keyrings/docker.asc
      echo \
        "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/${ID} ${VERSION_CODENAME} stable" |
        sudo tee /etc/apt/sources.list.d/docker.list >/dev/null
      sudo apt-get update
      sudo apt-get install -y docker-ce docker-ce-cli containerd.io docker-compose-plugin
    fi
  else
    echo "error: docker not found and neither pacman nor apt-get is available —" >&2
    echo "  install Docker manually (https://docs.docker.com/engine/install/)," >&2
    echo "  then re-run." >&2
    exit 1
  fi
else
  log "Docker already installed."
fi

docker_running() {
  # systemctl covers most distros (Arch/Omarchy, Ubuntu, Debian, Fedora...);
  # fall back to `docker info` for non-systemd setups (e.g. Docker Desktop,
  # WSL without systemd) where there's no docker.service to query.
  if command -v systemctl >/dev/null 2>&1 && systemctl list-unit-files docker.service >/dev/null 2>&1; then
    systemctl is-active --quiet docker
  else
    docker info >/dev/null 2>&1
  fi
}

if ! docker_running; then
  log "Docker isn't running — starting it..."
  if command -v systemctl >/dev/null 2>&1 && systemctl list-unit-files docker.service >/dev/null 2>&1; then
    sudo systemctl enable --now docker
  elif command -v service >/dev/null 2>&1; then
    sudo service docker start
  else
    echo "error: couldn't find a way to start Docker on this system — start" >&2
    echo "  it manually, then re-run." >&2
    exit 1
  fi
  # Give the daemon a moment to come up before anything tries to use it.
  for _ in $(seq 1 10); do
    docker_running && break
    sleep 1
  done
  if ! docker_running; then
    echo "error: Docker still isn't responding after starting it — check" >&2
    echo "  'sudo systemctl status docker' (or your distro's equivalent)." >&2
    exit 1
  fi
  log "Docker is now running."
else
  log "Docker service already running."
fi

NEEDS_GROUP_REFRESH="false"
if ! id -nG "$USER" | grep -qw docker; then
  log "Adding $USER to the docker group..."
  sudo usermod -aG docker "$USER"
  NEEDS_GROUP_REFRESH="true"
else
  log "$USER is already in the docker group."
fi

# -----------------------------------------------------------------------
# 2. Ollama
# -----------------------------------------------------------------------
log "Checking Ollama..."
OLLAMA_REACHABLE="false"
curl -fsS -m 3 http://127.0.0.1:11434/api/tags >/dev/null 2>&1 && OLLAMA_REACHABLE="true"

if ! have ollama && [[ "$OLLAMA_REACHABLE" == "false" ]]; then
  log "Installing Ollama (official install script)..."
  curl -fsSL https://ollama.com/install.sh | sh
else
  log "Ollama already installed/reachable."
fi

# The Lain container needs to reach Ollama via this machine's LAN IP, not
# localhost — if the ollama.service unit exists and isn't already
# listening on all interfaces, add a drop-in override for that.
if systemctl list-unit-files ollama.service >/dev/null 2>&1; then
  if ! ss -tlnp 2>/dev/null | grep -q "0.0.0.0:11434\|\*:11434"; then
    log "Configuring Ollama to listen on all interfaces (needed for Docker)..."
    sudo mkdir -p /etc/systemd/system/ollama.service.d
    sudo tee /etc/systemd/system/ollama.service.d/override.conf >/dev/null <<'EOF'
[Service]
Environment="OLLAMA_HOST=0.0.0.0"
EOF
    sudo systemctl daemon-reload
    sudo systemctl restart ollama
    sleep 1
  fi
fi

if have ollama; then
  for model in gemma4:e4b gemma4:12b; do
    if ! ollama list 2>/dev/null | grep -q "^${model}"; then
      log "Pulling model $model (this can take a while)..."
      ollama pull "$model"
    else
      log "Model $model already pulled."
    fi
  done
else
  log "ollama CLI not found locally but the API is reachable — make sure" \
    "gemma4:e4b and gemma4:12b are pulled on whatever host is serving it."
fi

# -----------------------------------------------------------------------
# 3. .env
# -----------------------------------------------------------------------
if [[ ! -f .env ]]; then
  log "Creating .env from .env.example..."
  cp .env.example .env
  # Generate a real AUTH_SECRET so there's one less manual step.
  auth_secret="$(openssl rand -base64 32)"
  sed -i "s#^AUTH_SECRET=.*#AUTH_SECRET=${auth_secret}#" .env
  # Point OLLAMA_HOST/LAIN_TOOLS_URL at this machine's real LAN IP instead
  # of the .env.example placeholder.
  lan_ip="$(ip -4 -o addr show scope global 2>/dev/null | awk '{print $4}' | cut -d/ -f1 | grep -vE '^172\.(1[7-9]|2[0-9]|3[0-1])\.' | head -1)"
  if [[ -n "$lan_ip" ]]; then
    sed -i "s#^OLLAMA_HOST=.*#OLLAMA_HOST=http://${lan_ip}:11434#" .env
  fi

  echo
  echo "⚠️  Created .env with a generated AUTH_SECRET, but you still need to:"
  echo "   1. Create a GitHub OAuth App (github.com/settings/developers) or"
  echo "      Google OAuth Client (console.cloud.google.com/apis/credentials)"
  echo "      with callback URL: http://localhost:3000/api/auth/callback/<provider>"
  echo "   2. Fill AUTH_GITHUB_ID/AUTH_GITHUB_SECRET (or AUTH_GOOGLE_ID/SECRET)"
  echo "      and ALLOWED_USERS in .env"
  echo
  echo "Then re-run ./install.sh to continue."
  exit 0
else
  log ".env already exists — leaving it as-is."
fi

# -----------------------------------------------------------------------
# 4. Optional: CLI + Hyprland keybinding
# -----------------------------------------------------------------------
if [[ "${LAIN_SKIP_CLI_SETUP:-}" != "true" ]] && [[ ! -f "$HOME/.local/bin/lain" ]]; then
  if confirm "Set up the 'lain' terminal command + Hyprland keybinding now?"; then
    ./scripts/setup-omarchy-cli.sh
  else
    log "Skipping — run ./scripts/setup-omarchy-cli.sh any time to enable it later."
  fi
else
  log "CLI already set up (or skipped via LAIN_SKIP_CLI_SETUP)."
fi

# -----------------------------------------------------------------------
# 5. Build & deploy (deploy.sh also offers tools-agent setup)
# -----------------------------------------------------------------------
log "Building and starting Lain..."
if [[ "$NEEDS_GROUP_REFRESH" == "true" ]]; then
  # Freshly added to the docker group in this same shell — `sg` applies the
  # new group membership without requiring a full logout/login.
  sg docker -c "./deploy.sh"
else
  ./deploy.sh
fi

echo
echo "==> All done! Lain should be running at http://localhost:3000"
if [[ "$NEEDS_GROUP_REFRESH" == "true" ]]; then
  echo "    (you were just added to the docker group — log out/in, or run"
  echo "    'newgrp docker', for it to apply in new shells going forward)"
fi
