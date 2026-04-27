#!/bin/bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
TARGET_DIR="${PI_CODING_AGENT_DIR:-$HOME/.pi/agent}"
REMOVE_EMPTY_DIRS=1
DRY_RUN=0

TOP_LEVEL_FILES=(
  settings.json
  models.json
  keybindings.json
  AGENTS.md
  SYSTEM.md
  APPEND_SYSTEM.md
)

TOP_LEVEL_DIRS=(
  prompts
  skills
  themes
  agents
)

usage() {
  cat <<'EOF'
Usage: uninstall.sh [--dry-run] [--keep-empty-dirs]

Environment:
  PI_CODING_AGENT_DIR   Target pi agent dir. Default: ~/.pi/agent

Removes only symlinks in the target pi agent dir that point into this repo's
pi-config directory. Local secrets and state are never removed.
EOF
}

log() {
  printf '%s\n' "$*"
}

is_managed_link() {
  local target="$1"

  [ -L "$target" ] || return 1

  local dest
  dest="$(readlink "$target")"
  case "$dest" in
    "$SCRIPT_DIR"|"$SCRIPT_DIR"/*)
      return 0
      ;;
    *)
      return 1
      ;;
  esac
}

remove_link() {
  local rel="$1"
  local target="$TARGET_DIR/$rel"

  if ! is_managed_link "$target"; then
    return
  fi

  if [ "$DRY_RUN" -eq 1 ]; then
    log "WOULD REMOVE $rel -> $(readlink "$target")"
    return
  fi

  rm "$target"
  log "REMOVE $rel"
}

remove_empty_dir() {
  local rel="$1"
  local target="$TARGET_DIR/$rel"

  [ "$REMOVE_EMPTY_DIRS" -eq 1 ] || return
  [ -d "$target" ] || return

  if [ "$DRY_RUN" -eq 1 ]; then
    if [ -z "$(find "$target" -mindepth 1 -maxdepth 1 -print -quit 2>/dev/null)" ]; then
      log "WOULD RMDIR $rel"
    fi
    return
  fi

  rmdir --ignore-fail-on-non-empty "$target" 2>/dev/null && log "RMDIR $rel" || true
}

remove_extension_links() {
  local source_root="$SCRIPT_DIR/extensions"
  local target_root="$TARGET_DIR/extensions"

  [ -d "$source_root" ] || return
  [ -d "$target_root" ] || return

  find "$source_root" -mindepth 1 -maxdepth 1 | sort | while read -r ext_source; do
    local ext_name ext_target
    ext_name="$(basename "$ext_source")"
    ext_target="$target_root/$ext_name"

    if [ -f "$ext_source" ]; then
      remove_link "extensions/$ext_name"
      continue
    fi

    [ -d "$ext_source" ] || continue
    [ -d "$ext_target" ] || continue

    find "$ext_source" -mindepth 1 -maxdepth 1 | sort | while read -r item_source; do
      local base
      base="$(basename "$item_source")"
      remove_link "extensions/$ext_name/$base"
    done

    remove_empty_dir "extensions/$ext_name"
  done

  remove_empty_dir extensions
}

while [ $# -gt 0 ]; do
  case "$1" in
    --dry-run)
      DRY_RUN=1
      shift
      ;;
    --keep-empty-dirs)
      REMOVE_EMPTY_DIRS=0
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "Unknown argument: $1" >&2
      usage >&2
      exit 1
      ;;
  esac
done

log "Repo:   $SCRIPT_DIR"
log "Target: $TARGET_DIR"

for rel in "${TOP_LEVEL_FILES[@]}"; do
  remove_link "$rel"
done

for rel in "${TOP_LEVEL_DIRS[@]}"; do
  remove_link "$rel"
done

remove_extension_links
