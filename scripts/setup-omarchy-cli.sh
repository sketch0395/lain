#!/usr/bin/env bash
# Sets up the Lain CLI + Omarchy integration (keybinding + launcher entry)
# on any machine running Omarchy. Safe to re-run (idempotent) — existing
# managed blocks are detected and skipped instead of duplicated.
#
# Usage:
#   ./scripts/setup-omarchy-cli.sh              # interactive
#   ./scripts/setup-omarchy-cli.sh --force       # overwrite existing config
#   LAIN_URL=... LAIN_API_TOKEN=... ./scripts/setup-omarchy-cli.sh --non-interactive
#
# Env overrides:
#   LAIN_KEYBIND   Hyprland keybinding to use (default: "SUPER + SHIFT + L")
#   LAIN_URL / LAIN_API_TOKEN   skip the interactive prompt if both are set

set -euo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BIN_SRC="$REPO_DIR/bin/lain"
BIN_DEST="$HOME/.local/bin/lain"
CONFIG_DIR="$HOME/.config/lain"
CONFIG_FILE="$CONFIG_DIR/config"
BINDINGS_FILE="$HOME/.config/hypr/bindings.lua"
HYPRLAND_FILE="$HOME/.config/hypr/hyprland.lua"
MENU_FILE="$HOME/.config/omarchy/extensions/omarchy-menu.jsonc"
KEYBIND="${LAIN_KEYBIND:-SUPER + SHIFT + L}"
APP_ID="lain-cli"

MARKER_BEGIN="-- >>> lain-cli (managed by scripts/setup-omarchy-cli.sh) >>>"
MARKER_END="-- <<< lain-cli <<<"

force="false"
non_interactive="false"
for arg in "$@"; do
  case "$arg" in
    --force) force="true" ;;
    --non-interactive) non_interactive="true" ;;
  esac
done

log() { echo "==> $*"; }
warn() { echo "WARNING: $*" >&2; }

# --- 0. sanity checks -------------------------------------------------------
if [[ -f /etc/os-release ]]; then
  # shellcheck disable=SC1091
  os_id="$(. /etc/os-release && echo "$ID")"
else
  os_id="unknown"
fi

is_omarchy="false"
if [[ "$os_id" == "omarchy" ]]; then
  is_omarchy="true"
else
  warn "This doesn't look like Omarchy (ID=$os_id). The CLI will still be" \
       "installed, but the Hyprland keybinding and launcher entry will be" \
       "skipped since they depend on Omarchy's config layout."
fi

command -v jq >/dev/null || { echo "jq is required (pacman -S jq, or apt install jq on Debian/Ubuntu)" >&2; exit 1; }
command -v curl >/dev/null || { echo "curl is required" >&2; exit 1; }
[[ -f "$BIN_SRC" ]] || { echo "Can't find $BIN_SRC — run this from the repo." >&2; exit 1; }

# --- 1. install the CLI binary ----------------------------------------------
mkdir -p "$(dirname "$BIN_DEST")"
cp "$BIN_SRC" "$BIN_DEST"
chmod +x "$BIN_DEST"
log "Installed CLI to $BIN_DEST"

case ":$PATH:" in
  *":$HOME/.local/bin:"*) ;;
  *) warn "$HOME/.local/bin is not on your PATH — add it in your shell rc." ;;
esac

# --- 2. CLI config (URL + token) --------------------------------------------
mkdir -p "$CONFIG_DIR"
if [[ -f "$CONFIG_FILE" && "$force" != "true" ]]; then
  log "Config already exists at $CONFIG_FILE — leaving as-is (use --force to overwrite)"
else
  if [[ -n "${LAIN_URL:-}" && -n "${LAIN_API_TOKEN:-}" ]]; then
    lain_url="$LAIN_URL"
    lain_token="$LAIN_API_TOKEN"
  elif [[ "$non_interactive" == "true" ]]; then
    echo "Set LAIN_URL and LAIN_API_TOKEN in the environment for --non-interactive mode." >&2
    exit 1
  else
    read -rp "Lain URL (e.g. https://lain.dialtone.cc): " lain_url
    read -rsp "Lain API token (matches server's LAIN_API_TOKEN): " lain_token
    echo
  fi

  ( umask 077
    cat > "$CONFIG_FILE" <<EOF
LAIN_URL=$lain_url
LAIN_API_TOKEN=$lain_token
EOF
  )
  chmod 600 "$CONFIG_FILE"
  log "Wrote $CONFIG_FILE (chmod 600)"
fi

if [[ "$is_omarchy" != "true" ]]; then
  log "Done. Run 'lain \"hello\"' to test."
  exit 0
fi

# --- 3. Hyprland keybinding --------------------------------------------------
mkdir -p "$(dirname "$BINDINGS_FILE")"
touch "$BINDINGS_FILE"

if grep -qFe "$MARKER_BEGIN" "$BINDINGS_FILE" 2>/dev/null; then
  log "Keybinding already present in $BINDINGS_FILE — skipping"
else
  if command -v omarchy >/dev/null && \
     omarchy menu keybindings --print 2>/dev/null | grep -qiF "$KEYBIND "; then
    warn "$KEYBIND is already bound to something else. Set LAIN_KEYBIND to" \
         "an unused combo and re-run, or edit $BINDINGS_FILE manually."
  else
    cp "$BINDINGS_FILE" "$BINDINGS_FILE.bak.$(date +%s)"
    {
      echo ""
      echo "$MARKER_BEGIN"
      echo "-- Lain chatbot: open a floating terminal running the CLI (window rule"
      echo "-- for this app-id lives in hyprland.lua). No --pick here: fzf's picker"
      echo "-- is unreliable as the very first thing in a brand-new terminal window."
      echo "-- Use the in-app Tab menu -> \"Switch conversation...\" instead once it's"
      echo "-- open (fzf works fine once the window is already rendering)."
      echo "o.bind(\"$KEYBIND\", \"Lain\", \"foot --app-id $APP_ID lain\")"
      echo "$MARKER_END"
    } >> "$BINDINGS_FILE"
    log "Added $KEYBIND keybinding to $BINDINGS_FILE"
  fi
fi

# --- 4. Hyprland floating window rule ---------------------------------------
mkdir -p "$(dirname "$HYPRLAND_FILE")"
touch "$HYPRLAND_FILE"

if grep -qFe "$MARKER_BEGIN" "$HYPRLAND_FILE" 2>/dev/null; then
  log "Window rule already present in $HYPRLAND_FILE — skipping"
else
  cp "$HYPRLAND_FILE" "$HYPRLAND_FILE.bak.$(date +%s)"
  {
    echo ""
    echo "$MARKER_BEGIN"
    echo "-- Float and size the Lain CLI terminal launched by the $KEYBIND binding."
    echo "o.window("
    echo "  { class = \"$APP_ID\" },"
    echo "  { float = true, size = \"45% 55%\", center = true }"
    echo ")"
    echo "$MARKER_END"
  } >> "$HYPRLAND_FILE"
  log "Added floating window rule to $HYPRLAND_FILE"
fi

# --- 5. Validate Hyprland config ---------------------------------------------
if command -v hyprctl >/dev/null; then
  hyprctl reload >/dev/null 2>&1 || true
  errors="$(hyprctl configerrors 2>&1 || true)"
  if [[ -n "$errors" ]]; then
    warn "hyprctl reported config errors — review them:"
    echo "$errors" >&2
  else
    log "Hyprland config validated clean (hyprctl configerrors)"
  fi
fi

# --- 6. Omarchy launcher/menu entry ------------------------------------------
mkdir -p "$(dirname "$MENU_FILE")"
[[ -f "$MENU_FILE" ]] || echo '{}' > "$MENU_FILE"

if grep -q '"lain"[[:space:]]*:' "$MENU_FILE" 2>/dev/null; then
  log "Menu entry already present in $MENU_FILE — skipping"
else
  cp "$MENU_FILE" "$MENU_FILE.bak.$(date +%s)"
  python3 - "$MENU_FILE" "$APP_ID" <<'PYEOF'
import sys

path, app_id = sys.argv[1], sys.argv[2]
with open(path, "r", encoding="utf-8") as f:
    content = f.read()

stripped = content.rstrip()
assert stripped.endswith("}"), f"{path} doesn't end with a closing brace"
idx = stripped.rfind("}")

entry = (
    '\n  "lain": {\n'
    '    "icon": "\uf7d4",\n'
    '    "label": "Lain",\n'
    '    "description": "Personal AI chatbot",\n'
    f'    "action": "foot --app-id {app_id} lain"\n'
    "  }\n"
)

before = stripped[:idx].rstrip()
# Add a separating comma only if there's a preceding real (non-comment) entry.
needs_comma = before.endswith("}") or before.endswith('"')
new_content = before + (",\n" if needs_comma else "\n") + entry + "}\n"

with open(path, "w", encoding="utf-8") as f:
    f.write(new_content)
PYEOF
  log "Added Lain entry to Omarchy launcher menu ($MENU_FILE)"
fi

log "All done. Press $KEYBIND or search \"Lain\" in the launcher."
