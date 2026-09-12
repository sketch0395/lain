#!/usr/bin/env bash
# Installs and starts lain-tools-agent as a systemd --user service on this
# machine. Idempotent — safe to re-run any time (e.g. after updating
# tools-agent/server.js).
#
# What it does:
#   1. Copies tools-agent/server.js to ~/.local/share/lain/tools-agent.js
#   2. Generates an LAIN_TOOLS_TOKEN (if one doesn't already exist) and
#      writes config to ~/.config/lain/tools-agent.env
#   3. Installs + enables a systemd --user unit that runs it on login/boot
#   4. Prints the LAIN_TOOLS_URL/LAIN_TOOLS_TOKEN to add to Lain's .env
#
# Note: the Omarchy status/theme tools (omarchy_status, list_omarchy_themes,
# set_omarchy_theme) need `hyprctl`, `omarchy-theme-list`, and
# `omarchy-theme-set` on PATH — i.e. an actual Omarchy/Hyprland desktop.
# Diagnostics and file tools work fine without them; the Omarchy tools will
# just error out if called on a machine that isn't running Omarchy.
#
# Forensics tools (hash_file, file_metadata, extract_strings, list_processes,
# network_connections, search_logs, recent_file_activity, login_history,
# analyze_pcap) work out of the box, except analyze_pcap (needs `tcpdump`)
# and EXIF data in file_metadata (needs `exiftool`) — this script offers to
# install both automatically via pacman if missing.
#
# Env overrides (optional, otherwise you'll be prompted):
#   LAIN_TOOLS_PORT           default 8787
#   LAIN_TOOLS_ALLOWED_ROOTS  comma-separated dirs Lain may read (default: $HOME)
#   LAIN_TOOLS_TOKEN          reuse an existing token instead of generating one

set -euo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
INSTALL_DIR="$HOME/.local/share/lain"
CONFIG_DIR="$HOME/.config/lain"
ENV_FILE="$CONFIG_DIR/tools-agent.env"
UNIT_DIR="$HOME/.config/systemd/user"
UNIT_FILE="$UNIT_DIR/lain-tools-agent.service"

echo "==> Installing lain-tools-agent"

if ! command -v node >/dev/null 2>&1; then
  echo "error: node is required but not found on PATH." >&2
  exit 1
fi

if ! command -v hyprctl >/dev/null 2>&1 || ! command -v omarchy-theme-set >/dev/null 2>&1; then
  echo "warning: hyprctl/omarchy-theme-set not found on PATH — the Omarchy" >&2
  echo "  status/theme tools won't work here, but diagnostics/file tools will." >&2
fi

# --- Optional forensics-tool dependencies -----------------------------------
# tcpdump powers analyze_pcap; exiftool adds EXIF data to file_metadata for
# images. Both are optional — the corresponding features just degrade
# gracefully (analyze_pcap errors clearly, EXIF comes back null) if missing —
# but we try to install them automatically so a fresh install has full
# functionality without the user having to know that in advance.
missing_pkgs=()
command -v tcpdump >/dev/null 2>&1 || missing_pkgs+=("tcpdump")
command -v exiftool >/dev/null 2>&1 || missing_pkgs+=("perl-image-exiftool")

if [[ ${#missing_pkgs[@]} -gt 0 ]]; then
  echo "==> Optional forensics dependencies missing: ${missing_pkgs[*]}"
  if command -v pacman >/dev/null 2>&1; then
    if [[ -t 0 ]]; then
      read -r -p "Install with pacman now? [Y/n] " reply
    else
      reply="n"
    fi
    if [[ ! "$reply" =~ ^[Nn] ]]; then
      sudo pacman -S --needed --noconfirm "${missing_pkgs[@]}" \
        && echo "  - installed: ${missing_pkgs[*]}" \
        || echo "  - install failed — analyze_pcap/EXIF will be unavailable until installed manually." >&2
    else
      echo "  - skipping — install later with: sudo pacman -S --needed ${missing_pkgs[*]}"
    fi
  else
    echo "  - pacman not found (non-Arch system) — install the equivalent" >&2
    echo "    packages for tcpdump/exiftool manually if you want analyze_pcap" >&2
    echo "    and image EXIF data to work." >&2
  fi
fi

mkdir -p "$INSTALL_DIR" "$CONFIG_DIR" "$UNIT_DIR"
cp "$REPO_DIR/tools-agent/server.js" "$INSTALL_DIR/tools-agent.js"
echo "  - copied server.js -> $INSTALL_DIR/tools-agent.js"

# --- Config: port, allowed roots, token -------------------------------------
LAIN_TOOLS_PORT="${LAIN_TOOLS_PORT:-}"
if [[ -z "$LAIN_TOOLS_PORT" ]]; then
  read -r -p "Port for the tools agent to listen on [8787]: " LAIN_TOOLS_PORT
  LAIN_TOOLS_PORT="${LAIN_TOOLS_PORT:-8787}"
fi

LAIN_TOOLS_ALLOWED_ROOTS="${LAIN_TOOLS_ALLOWED_ROOTS:-}"
if [[ -z "$LAIN_TOOLS_ALLOWED_ROOTS" ]]; then
  read -r -p "Directories Lain may read from, comma-separated [$HOME]: " LAIN_TOOLS_ALLOWED_ROOTS
  LAIN_TOOLS_ALLOWED_ROOTS="${LAIN_TOOLS_ALLOWED_ROOTS:-$HOME}"
fi

LAIN_TOOLS_TOKEN="${LAIN_TOOLS_TOKEN:-}"
if [[ -z "$LAIN_TOOLS_TOKEN" && -f "$ENV_FILE" ]]; then
  # Reuse an existing token from a previous run instead of rotating it
  # (rotating would also require updating the server's .env).
  LAIN_TOOLS_TOKEN="$(grep -oP '(?<=^LAIN_TOOLS_TOKEN=).*' "$ENV_FILE" || true)"
fi
if [[ -z "$LAIN_TOOLS_TOKEN" ]]; then
  LAIN_TOOLS_TOKEN="$(openssl rand -hex 32)"
  echo "  - generated a new LAIN_TOOLS_TOKEN"
fi

cat > "$ENV_FILE" <<EOF
LAIN_TOOLS_PORT=$LAIN_TOOLS_PORT
LAIN_TOOLS_ALLOWED_ROOTS=$LAIN_TOOLS_ALLOWED_ROOTS
LAIN_TOOLS_TOKEN=$LAIN_TOOLS_TOKEN
EOF
chmod 600 "$ENV_FILE"
echo "  - wrote config -> $ENV_FILE (chmod 600)"

# --- systemd --user unit -----------------------------------------------------
NODE_BIN="$(command -v node)"
cat > "$UNIT_FILE" <<EOF
[Unit]
Description=Lain tools agent (diagnostics/file/Omarchy access for Lain chatbot)
After=network.target

[Service]
EnvironmentFile=$ENV_FILE
ExecStart=$NODE_BIN $INSTALL_DIR/tools-agent.js
Restart=on-failure
RestartSec=5

[Install]
WantedBy=default.target
EOF
echo "  - wrote systemd unit -> $UNIT_FILE"

systemctl --user daemon-reload
systemctl --user enable --now lain-tools-agent
sleep 1
systemctl --user --no-pager status lain-tools-agent | head -5

echo
echo "==> Done."
echo
LAN_IP="$(ip -4 -o addr show scope global 2>/dev/null | awk '{print $4}' | cut -d/ -f1 | grep -v '^172\.\(1[7-9]\|2[0-9]\|3[0-1]\)\.' | head -1)"
LAN_IP="${LAN_IP:-<this-machine-ip>}"
echo "Add these to Lain's .env (same machine, since Lain runs in Docker and"
echo "needs this machine's LAN IP rather than localhost to reach the agent):"
echo "  LAIN_TOOLS_URL=http://$LAN_IP:$LAIN_TOOLS_PORT"
echo "  LAIN_TOOLS_TOKEN=$LAIN_TOOLS_TOKEN"
echo
echo "Then redeploy: ./deploy.sh (or: docker compose up -d --build)"
echo
echo "If you have a firewall (ufw/firewalld) active, make sure it allows"
echo "Docker traffic to port $LAIN_TOOLS_PORT — it's not exposed to the"
echo "internet, but the Lain container needs to reach it. Docker compose"
echo "projects get their own subnet (not always 172.17.0.0/16), so allow"
echo "the whole private Docker range to be safe, e.g.:"
echo "  sudo ufw allow from 172.16.0.0/12 to any port $LAIN_TOOLS_PORT proto tcp"
echo
echo "Useful commands:"
echo "  systemctl --user status lain-tools-agent"
echo "  systemctl --user restart lain-tools-agent"
echo "  journalctl --user -u lain-tools-agent -f"
