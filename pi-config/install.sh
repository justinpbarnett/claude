#!/bin/bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
TARGET_DIR="${PI_CODING_AGENT_DIR:-$HOME/.pi/agent}"
MODE="symlink"
RUN_NPM=1
BACKUP_ROOT="${PI_CONFIG_BACKUP_DIR:-$HOME/.local/state/pi-config-backups}"
BACKUP_DIR=""
BACKUP_USED=0

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
Usage: install.sh [--mode symlink|copy] [--no-npm]

Environment:
  PI_CODING_AGENT_DIR   Target pi agent dir. Default: ~/.pi/agent
  PI_CONFIG_BACKUP_DIR  Backup root for replaced items in symlink mode.
                        Default: ~/.local/state/pi-config-backups

Notes:
  Secrets and local state are never copied from this repo.
  auth.json, sessions, git, bin, extension .env files, extension .npm dirs, and node_modules stay local.
EOF
}

log() {
  printf '%s\n' "$*"
}

ensure_backup_dir() {
  if [ "$BACKUP_USED" -eq 0 ]; then
    BACKUP_DIR="$BACKUP_ROOT/$(date +%Y%m%d%H%M%S)"
    mkdir -p "$BACKUP_DIR"
    BACKUP_USED=1
  fi
}

backup_target() {
  local target="$1"
  local rel="$2"

  if [ ! -e "$target" ] && [ ! -L "$target" ]; then
    return
  fi

  ensure_backup_dir
  mkdir -p "$BACKUP_DIR/$(dirname "$rel")"
  mv "$target" "$BACKUP_DIR/$rel"
  log "BACKUP $rel -> $BACKUP_DIR/$rel"
}

ensure_parent() {
  mkdir -p "$(dirname "$1")"
}

same_link() {
  local target="$1"
  local source="$2"

  [ -L "$target" ] && [ "$(readlink "$target")" = "$source" ]
}

install_file() {
  local rel="$1"
  local source="$SCRIPT_DIR/$rel"
  local target="$TARGET_DIR/$rel"

  if [ ! -f "$source" ]; then
    return
  fi

  ensure_parent "$target"

  if [ "$MODE" = "symlink" ]; then
    if same_link "$target" "$source"; then
      log "KEEP $rel"
      return
    fi

    if [ -e "$target" ] || [ -L "$target" ]; then
      backup_target "$target" "$rel"
    fi

    ln -s "$source" "$target"
    log "LINK $rel -> $source"
    return
  fi

  if [ -L "$target" ]; then
    backup_target "$target" "$rel"
  fi

  cp -a "$source" "$target"
  log "COPY $rel"
}

install_dir() {
  local rel="$1"
  local source="$SCRIPT_DIR/$rel"
  local target="$TARGET_DIR/$rel"

  if [ ! -d "$source" ]; then
    return
  fi

  ensure_parent "$target"

  if [ "$MODE" = "symlink" ]; then
    if same_link "$target" "$source"; then
      log "KEEP $rel"
      return
    fi

    if [ -e "$target" ] || [ -L "$target" ]; then
      backup_target "$target" "$rel"
    fi

    ln -s "$source" "$target"
    log "LINK $rel -> $source"
    return
  fi

  mkdir -p "$target"
  cp -a "$source/." "$target/"
  log "SYNC $rel"
}

install_extension_files() {
  local source_root="$SCRIPT_DIR/extensions"
  local target_root="$TARGET_DIR/extensions"

  if [ ! -d "$source_root" ]; then
    return
  fi

  mkdir -p "$target_root"

  find "$source_root" -mindepth 1 -maxdepth 1 -type d | sort | while read -r ext_source; do
    local ext_name ext_target
    ext_name="$(basename "$ext_source")"
    ext_target="$target_root/$ext_name"
    mkdir -p "$ext_target"

    find "$ext_source" -mindepth 1 -maxdepth 1 | sort | while read -r item_source; do
      local base rel item_target
      base="$(basename "$item_source")"
      case "$base" in
        .env|.npm|node_modules)
          continue
          ;;
      esac

      rel="extensions/$ext_name/$base"
      item_target="$ext_target/$base"

      if [ "$MODE" = "symlink" ]; then
        if same_link "$item_target" "$item_source"; then
          log "KEEP $rel"
          continue
        fi

        if [ -e "$item_target" ] || [ -L "$item_target" ]; then
          backup_target "$item_target" "$rel"
        fi

        ln -s "$item_source" "$item_target"
        log "LINK $rel -> $item_source"
      else
        if [ -L "$item_target" ]; then
          backup_target "$item_target" "$rel"
        fi

        cp -a "$item_source" "$item_target"
        log "COPY $rel"
      fi
    done
  done
}

install_extension_deps() {
  local target_root="$TARGET_DIR/extensions"

  if [ "$RUN_NPM" -ne 1 ] || [ ! -d "$target_root" ]; then
    return
  fi

  find "$target_root" -mindepth 2 -maxdepth 2 -name package.json | sort | while read -r package_file; do
    local ext_dir
    ext_dir="$(dirname "$package_file")"
    log "NPM $ext_dir"
    (
      cd "$ext_dir"
      npm install
    )
  done
}

while [ $# -gt 0 ]; do
  case "$1" in
    --mode)
      MODE="$2"
      shift 2
      ;;
    --no-npm)
      RUN_NPM=0
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

case "$MODE" in
  symlink|copy)
    ;;
  *)
    echo "Invalid mode: $MODE" >&2
    exit 1
    ;;
esac

mkdir -p "$TARGET_DIR"

log "Repo:   $SCRIPT_DIR"
log "Target: $TARGET_DIR"
log "Mode:   $MODE"

for rel in "${TOP_LEVEL_FILES[@]}"; do
  install_file "$rel"
done

for rel in "${TOP_LEVEL_DIRS[@]}"; do
  install_dir "$rel"
done

install_extension_files
install_extension_deps

if [ "$BACKUP_USED" -eq 1 ]; then
  log "Backups: $BACKUP_DIR"
else
  log "Backups: none"
fi
