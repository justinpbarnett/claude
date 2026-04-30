#!/bin/bash
set -euo pipefail

REPO_DIR="$(cd "$(dirname "$0")" && pwd)"

# ─────────────────────────────────────────────────────────────────────────────
# Harness definitions
# Each harness function declares: target dir, items to symlink (target=source)
# ─────────────────────────────────────────────────────────────────────────────

install_claude() {
    local target="$HOME/.claude"
    echo "  Target: $target"
    mkdir -p "$target"

    link "$REPO_DIR/skills"                       "$target/skills"
    link "$REPO_DIR/agents"                       "$target/agents"
    link "$REPO_DIR/hooks"                        "$target/hooks"
    link "$REPO_DIR/rules"                        "$target/rules"
    link "$REPO_DIR/plugins"                      "$target/plugins"
    link "$REPO_DIR/AGENTS.md"                    "$target/CLAUDE.md"
    link "$REPO_DIR/harness/claude/settings.json" "$target/settings.json"
}

install_forge() {
    local target="$HOME/forge"
    echo "  Target: $target"
    mkdir -p "$target"

    link "$REPO_DIR/skills"                           "$target/skills"
    link "$REPO_DIR/harness/forge/agents"             "$target/agents"
    link "$REPO_DIR/AGENTS.md"                        "$target/AGENTS.md"
    link "$REPO_DIR/harness/forge/.forge.toml"        "$target/.forge.toml"
}

install_opencode() {
    local target="$HOME/.config/opencode"
    echo "  Target: $target"
    mkdir -p "$target"

    link "$REPO_DIR/skills"                          "$target/skills"
    link "$REPO_DIR/agents"                          "$target/agents"
    link "$REPO_DIR/AGENTS.md"                       "$target/AGENTS.md"
    link "$REPO_DIR/harness/opencode/opencode.json"  "$target/opencode.json"
}

install_codex() {
    local target="$HOME/.codex"
    echo "  Target: $target"
    mkdir -p "$target"

    link_children "$REPO_DIR/skills"                 "$target/skills"
    link "$REPO_DIR/agents"                          "$target/agents"
    link "$REPO_DIR/AGENTS.md"                       "$target/AGENTS.md"
    link "$REPO_DIR/harness/codex/config.toml"       "$target/config.toml"
}

install_pi() {
    local settings_file="${PI_SETTINGS_FILE:-$HOME/.pi/agent/settings.json}"
    local package_path="$REPO_DIR/packages/quality-autoresearch"
    echo "  Settings: $settings_file"
    echo "  Package: $package_path"
    mkdir -p "$(dirname "$settings_file")"

    SETTINGS_FILE="$settings_file" PACKAGE_PATH="$package_path" python - <<'PY'
import json
import os
from pathlib import Path

settings_path = Path(os.environ["SETTINGS_FILE"])
package_path = os.environ["PACKAGE_PATH"]

if settings_path.exists() and settings_path.read_text().strip():
    data = json.loads(settings_path.read_text())
else:
    data = {}

packages = data.get("packages", [])
if not isinstance(packages, list):
    raise SystemExit("settings.json field 'packages' exists but is not a list")

if package_path not in packages:
    packages.append(package_path)

data["packages"] = packages
settings_path.write_text(json.dumps(data, indent=2) + "\n")
PY
    echo "    ADDED quality-autoresearch package"
}

# ─────────────────────────────────────────────────────────────────────────────
# Helpers
# ─────────────────────────────────────────────────────────────────────────────

link() {
    local source="$1"
    local target="$2"
    local name
    name="$(basename "$target")"

    if [ ! -e "$source" ]; then
        echo "    SKIP $name (not in repo)"
        return
    fi

    # Back up non-symlink targets
    if [ -e "$target" ] && [ ! -L "$target" ]; then
        local backup="$target.bak.$(date +%Y%m%d%H%M%S)"
        echo "    BACKUP $name -> $backup"
        mv "$target" "$backup"
    fi

    # Remove existing symlink
    if [ -L "$target" ]; then
        rm "$target"
    fi

    ln -s "$source" "$target"
    echo "    LINK $name -> $source"
}

link_children() {
    local source_dir="$1"
    local target_dir="$2"
    local name
    local target
    local backup_dir=""
    local timestamp

    timestamp="$(date +%Y%m%d%H%M%S)"

    if [ ! -d "$source_dir" ]; then
        echo "    SKIP $(basename "$target_dir") (not in repo)"
        return
    fi

    mkdir -p "$target_dir"

    for source in "$source_dir"/*; do
        [ -e "$source" ] || continue
        name="$(basename "$source")"
        target="$target_dir/$name"

        if [ -e "$target" ] && [ ! -L "$target" ]; then
            if [ -z "$backup_dir" ]; then
                backup_dir="$(dirname "$target_dir")/$(basename "$target_dir").bak.$timestamp"
                mkdir -p "$backup_dir"
            fi
            echo "    BACKUP $name -> $backup_dir/$name"
            mv "$target" "$backup_dir/$name"
        fi

        if [ -L "$target" ]; then
            rm "$target"
        fi

        ln -s "$source" "$target"
        echo "    LINK $name -> $source"
    done
}

usage() {
    echo "Usage: $0 [harness|all]"
    echo ""
    echo "Harnesses:"
    echo "  claude     Claude Code (~/.claude/)"
    echo "  forge      ForgeCode   (~/forge/)"
    echo "  opencode   OpenCode    (~/.config/opencode/)"
    echo "  codex      Codex CLI   (~/.codex/)"
    echo "  pi         Pi packages (~/.pi/agent/settings.json)"
    echo "  all        All harnesses"
    echo ""
    echo "Examples:"
    echo "  $0 claude          # Install Claude Code only"
    echo "  $0 forge opencode  # Install Forge and OpenCode"
    echo "  $0 all             # Install all harnesses"
    echo "  $0                 # Interactive: select harnesses"
}

ALL_HARNESSES=(claude forge opencode codex pi)

select_interactive() {
    echo "Which harnesses do you want to install?"
    echo ""
    for i in "${!ALL_HARNESSES[@]}"; do
        echo "  $((i+1)). ${ALL_HARNESSES[$i]}"
    done
    echo "  a. All"
    echo ""
    read -rp "Choice (e.g. 1 3, or a for all): " choices

    if [[ "$choices" == "a" || "$choices" == "all" ]]; then
        SELECTED=("${ALL_HARNESSES[@]}")
        return
    fi

    SELECTED=()
    for choice in $choices; do
        if [[ "$choice" =~ ^[0-9]+$ ]] && (( choice >= 1 && choice <= ${#ALL_HARNESSES[@]} )); then
            SELECTED+=("${ALL_HARNESSES[$((choice-1))]}")
        else
            echo "Invalid choice: $choice"
            exit 1
        fi
    done
}

# ─────────────────────────────────────────────────────────────────────────────
# Main
# ─────────────────────────────────────────────────────────────────────────────

echo "AI Coding Harness Installer"
echo "Source: $REPO_DIR"
echo ""

SELECTED=()

if [ $# -eq 0 ]; then
    select_interactive
elif [ "$1" = "all" ]; then
    SELECTED=("${ALL_HARNESSES[@]}")
elif [ "$1" = "-h" ] || [ "$1" = "--help" ]; then
    usage
    exit 0
else
    SELECTED=("$@")
fi

for harness in "${SELECTED[@]}"; do
    case "$harness" in
        claude|forge|opencode|codex|pi)
            echo "Installing $harness..."
            "install_$harness"
            echo ""
            ;;
        *)
            echo "Unknown harness: $harness"
            usage
            exit 1
            ;;
    esac
done

echo "Done. Restart your coding harness(es) to pick up changes."
