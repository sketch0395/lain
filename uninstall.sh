#!/usr/bin/env bash
# Reverses everything install.sh / deploy.sh / scripts/setup-*.sh set up —
# the container, the optional tools agent, and the optional CLI/Hyprland
# integration. Interactive and conservative by default: anything
# destructive (deleting your chat history/memories, or your .env secrets)
# is off unless you explicitly confirm it or pass the matching flag.
#
# What it can remove, in order (each step asks first unless noted):
#   1. The running container (always: `docker compose down`).
#   2. The built Docker image (lain:latest) — optional.
#   3. The data volume (ALL conversations/memories/reminders/threat intel/
#      playbooks/etc.) — optional, off by default, irreversible.
#   4. The lain-tools-agent systemd --user service + its installed files
#      (~/.local/share/lain, ~/.config/lain/tools-agent.env) — optional.
#   5. The `lain` CLI command, its Hyprland keybinding/window rule, and its
#      Omarchy launcher menu entry — optional.
#   6. .env (contains your OAuth/API secrets) — optional, off by default.
#
# This script does NOT delete the repo checkout itself — remove that by
# hand (`rm -rf` the directory) once you're done, if you want it gone too.
#
# Usage:
#   ./uninstall.sh                    # interactive, local (default, same as deploy.sh)
#   ./uninstall.sh --host 10.5.1.30   # uninstall a remote deploy over SSH instead
#   ./uninstall.sh --non-interactive  # skip all prompts (keeps data/.env unless told otherwise)
#   ./uninstall.sh --purge-data       # also remove the Docker volume (DESTROYS all stored data)
#   ./uninstall.sh --remove-env       # also delete .env
#   ./uninstall.sh --all              # equivalent to --purge-data --remove-env, assumes yes to everything else
#
# Env vars LAIN_SSH_HOST / LAIN_SSH_USER / LAIN_SSH_PORT / LAIN_REMOTE_DIR
# work the same as deploy.sh's --host/--user/--port/--dir.

set -euo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$REPO_DIR"

LAIN_SSH_HOST="${LAIN_SSH_HOST:-}"
LAIN_SSH_USER="${LAIN_SSH_USER:-$USER}"
LAIN_SSH_PORT="${LAIN_SSH_PORT:-22}"
LAIN_REMOTE_DIR="${LAIN_REMOTE_DIR:-~/lain}"

non_interactive="false"
purge_data="false"
remove_env="false"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --host) LAIN_SSH_HOST="$2"; shift 2 ;;
    --user) LAIN_SSH_USER="$2"; shift 2 ;;
    --port) LAIN_SSH_PORT="$2"; shift 2 ;;
    --dir) LAIN_REMOTE_DIR="$2"; shift 2 ;;
    --non-interactive) non_interactive="true"; shift ;;
    --purge-data) purge_data="true"; shift ;;
    --remove-env) remove_env="true"; shift ;;
    --all) non_interactive="true"; purge_data="true"; remove_env="true"; shift ;;
    -h|--help)
      cat <<'EOF'
Usage: ./uninstall.sh [--host IP] [--user NAME] [--port N] [--dir PATH]
                       [--non-interactive] [--purge-data] [--remove-env] [--all]

No flags: interactive local uninstall — asks before anything destructive.

  --host IP        Uninstall a remote deploy over SSH instead of locally
                    (stops/removes the container there; the tools agent and
                    CLI/Hyprland integration are always handled locally,
                    since those run on this machine regardless of where the
                    container itself lives).
  --user/--port/--dir   Same as deploy.sh, for the remote target.
  --non-interactive   Don't prompt — keeps data/.env unless also given
                    --purge-data/--remove-env.
  --purge-data      Also delete the Docker volume (ALL stored conversations,
                    memories, reminders, threat intel, playbooks, incident
                    reports, etc.) — irreversible.
  --remove-env      Also delete .env (your OAuth/API secrets).
  --all             Shorthand for --non-interactive --purge-data --remove-env.
EOF
      exit 0
      ;;
    *) echo "Unknown argument: $1 (see --help)" >&2; exit 1 ;;
  esac
done

log() { echo "==> $*"; }
warn() { echo "==> WARNING: $*" >&2; }
have() { command -v "$1" >/dev/null 2>&1; }

confirm() {
  # confirm "prompt" — yes by default (including non-interactive/no tty).
  local prompt="$1" reply
  if [[ "$non_interactive" == "true" || ! -t 0 ]]; then
    return 0
  fi
  read -r -p "$prompt [Y/n] " reply
  [[ ! "$reply" =~ ^[Nn] ]]
}

confirm_default_no() {
  # Same as confirm(), but defaults to "no" when non-interactive/no tty or
  # left blank — used for destructive/irreversible steps.
  local prompt="$1" reply
  if [[ "$non_interactive" == "true" || ! -t 0 ]]; then
    return 1
  fi
  read -r -p "$prompt [y/N] " reply
  [[ "$reply" =~ ^[Yy] ]]
}

echo
echo "###############################################"
echo "#  Lain — uninstall                          #"
echo "###############################################"
echo

# -----------------------------------------------------------------------
# 1-3. Container, image, data volume
# -----------------------------------------------------------------------
if [[ -n "$LAIN_SSH_HOST" ]]; then
  log "Stopping Lain on ${LAIN_SSH_HOST}:${LAIN_REMOTE_DIR}..."
  down_flag=""
  if [[ "$purge_data" == "true" ]] || confirm_default_no "Also permanently delete all stored data (conversations, memories, reminders, threat intel, playbooks, etc.) on ${LAIN_SSH_HOST}? This cannot be undone."; then
    down_flag="-v"
  fi
  ssh -p "${LAIN_SSH_PORT}" "${LAIN_SSH_USER}@${LAIN_SSH_HOST}" \
    "cd ${LAIN_REMOTE_DIR} 2>/dev/null && docker compose down ${down_flag} 2>/dev/null || true"
  if confirm_default_no "Also remove the built Docker image (lain:latest) on ${LAIN_SSH_HOST}?"; then
    ssh -p "${LAIN_SSH_PORT}" "${LAIN_SSH_USER}@${LAIN_SSH_HOST}" "docker rmi lain:latest 2>/dev/null || true"
  fi
  if confirm_default_no "Also delete the remote deployment directory itself (${LAIN_REMOTE_DIR} on ${LAIN_SSH_HOST})? This removes its .env too."; then
    ssh -p "${LAIN_SSH_PORT}" "${LAIN_SSH_USER}@${LAIN_SSH_HOST}" "rm -rf ${LAIN_REMOTE_DIR}"
    log "Removed ${LAIN_REMOTE_DIR} on ${LAIN_SSH_HOST}."
  fi
  log "Remote container stopped/removed. Continuing with local tools agent / CLI cleanup below..."
else
  if have docker && docker compose version >/dev/null 2>&1; then
    if [[ "$purge_data" == "true" ]] || confirm_default_no "Also permanently delete all stored data (conversations, memories, reminders, threat intel, playbooks, etc.) by removing the Docker volume? This cannot be undone."; then
      log "Stopping container and removing data volume..."
      docker compose down -v 2>/dev/null || true
    else
      log "Stopping container (keeping data volume)..."
      docker compose down 2>/dev/null || true
    fi
    if confirm_default_no "Also remove the built Docker image (lain:latest)?"; then
      docker image rm lain:latest 2>/dev/null || true
      log "Removed image lain:latest."
    fi
  else
    log "Docker/compose not found or no container running — skipping."
  fi
fi

# -----------------------------------------------------------------------
# 4. Tools agent (systemd --user service)
# -----------------------------------------------------------------------
TOOLS_INSTALL_DIR="$HOME/.local/share/lain"
TOOLS_CONFIG_DIR="$HOME/.config/lain"
TOOLS_ENV_FILE="$TOOLS_CONFIG_DIR/tools-agent.env"
TOOLS_UNIT_FILE="$HOME/.config/systemd/user/lain-tools-agent.service"

if [[ -f "$TOOLS_ENV_FILE" || -f "$TOOLS_UNIT_FILE" ]]; then
  if confirm "Remove the lain-tools-agent service (diagnostics/files/Omarchy access) and its installed files?"; then
    if have systemctl; then
      systemctl --user disable --now lain-tools-agent 2>/dev/null || true
    fi
    rm -f "$TOOLS_UNIT_FILE"
    have systemctl && systemctl --user daemon-reload 2>/dev/null || true
    rm -rf "$TOOLS_INSTALL_DIR"
    rm -f "$TOOLS_ENV_FILE"
    log "Removed lain-tools-agent service and $TOOLS_INSTALL_DIR."

    # tcpdump was optionally granted cap_net_raw/cap_net_admin by
    # setup-tools-agent.sh for capture_packets — ask before reverting since
    # it's a system-wide capability other tools (e.g. Wireshark) might also
    # rely on, so default to leaving it alone.
    if have tcpdump && have getcap; then
      tcpdump_bin="$(command -v tcpdump)"
      if getcap "$tcpdump_bin" 2>/dev/null | grep -q cap_net_raw; then
        if confirm_default_no "Also revert tcpdump's packet-capture permissions (cap_net_raw/cap_net_admin) granted for capture_packets?"; then
          sudo setcap -r "$tcpdump_bin" 2>/dev/null && log "Reverted tcpdump capabilities." \
            || warn "Failed to revert tcpdump capabilities — remove manually with: sudo setcap -r $tcpdump_bin"
        fi
      fi
    fi
  else
    log "Skipping tools agent removal."
  fi
else
  log "Tools agent not installed — skipping."
fi

# -----------------------------------------------------------------------
# 5. CLI + Hyprland integration
# -----------------------------------------------------------------------
CLI_BIN="$HOME/.local/bin/lain"
CLI_CONFIG_FILE="$TOOLS_CONFIG_DIR/config"
BINDINGS_FILE="$HOME/.config/hypr/bindings.lua"
HYPRLAND_FILE="$HOME/.config/hypr/hyprland.lua"
MENU_FILE="$HOME/.config/omarchy/extensions/omarchy-menu.jsonc"
MARKER_BEGIN="-- >>> lain-cli (managed by scripts/setup-omarchy-cli.sh) >>>"
MARKER_END="-- <<< lain-cli <<<"

if [[ -f "$CLI_BIN" || -f "$CLI_CONFIG_FILE" ]]; then
  if confirm "Remove the 'lain' CLI command and its Hyprland keybinding/menu entry?"; then
    rm -f "$CLI_BIN"
    rm -f "$CLI_CONFIG_FILE"
    log "Removed $CLI_BIN and $CLI_CONFIG_FILE."

    for f in "$BINDINGS_FILE" "$HYPRLAND_FILE"; do
      if [[ -f "$f" ]] && grep -qF "$MARKER_BEGIN" "$f" 2>/dev/null; then
        cp "$f" "$f.bak.$(date +%s)"
        sed -i "\#${MARKER_BEGIN}#,\#${MARKER_END}#d" "$f"
        log "Removed managed block from $f (backup saved alongside it)."
      fi
    done

    if [[ -f "$MENU_FILE" ]] && grep -q '"lain"[[:space:]]*:' "$MENU_FILE" 2>/dev/null && have python3; then
      cp "$MENU_FILE" "$MENU_FILE.bak.$(date +%s)"
      python3 - "$MENU_FILE" <<'PYEOF'
import re
import sys

path = sys.argv[1]
with open(path, "r", encoding="utf-8") as f:
    content = f.read()

# Mirrors the text-surgery setup-omarchy-cli.sh used to insert this entry
# (not a strict JSON parse, since the file allows // comments) — strip the
# "lain": { ... } block (no nested braces inside it) plus a neighboring
# comma so the file stays valid.
new_content = re.sub(r',?\s*"lain"\s*:\s*\{[^{}]*\}\s*,?', lambda m: "," if m.group(0).count(",") == 2 else "", content, count=1)
# Clean up a now-possibly-dangling leading comma right after the opening brace.
new_content = re.sub(r'\{\s*,', "{", new_content, count=1)

with open(path, "w", encoding="utf-8") as f:
    f.write(new_content)
PYEOF
      log "Removed Lain entry from Omarchy launcher menu ($MENU_FILE)."
    fi

    if have hyprctl; then
      hyprctl reload >/dev/null 2>&1 || true
    fi
  else
    log "Skipping CLI/Hyprland removal."
  fi
else
  log "CLI not installed — skipping."
fi

# Clean up the shared config dir if nothing's left in it.
if [[ -d "$TOOLS_CONFIG_DIR" ]] && [[ -z "$(ls -A "$TOOLS_CONFIG_DIR" 2>/dev/null)" ]]; then
  rmdir "$TOOLS_CONFIG_DIR"
fi

# -----------------------------------------------------------------------
# 6. .env
# -----------------------------------------------------------------------
if [[ -f .env ]]; then
  if [[ "$remove_env" == "true" ]] || confirm_default_no "Delete .env (contains your AUTH_SECRET/OAuth/API keys)?"; then
    rm -f .env
    log "Removed .env."
  else
    log "Keeping .env — delete it by hand later if you want it gone too."
  fi
fi

echo
log "Done. This script did not delete the repo checkout itself ($REPO_DIR)."
log "Remove it by hand (rm -rf) if you want Lain fully gone from this machine."
