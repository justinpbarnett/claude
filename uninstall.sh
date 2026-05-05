#!/bin/bash
set -euo pipefail

REPO_DIR="$(cd "$(dirname "$0")" && pwd)"

# ─────────────────────────────────────────────────────────────────────────────
# Harness definitions (must mirror install.sh)
# ─────────────────────────────────────────────────────────────────────────────

uninstall_claude() {
    local target="$HOME/.claude"
    echo "  Target: $target"
    unlink_item "$target/skills"
    unlink_item "$target/agents"
    unlink_item "$target/hooks"
    unlink_item "$target/rules"
    unlink_item "$target/plugins"
    unlink_item "$target/CLAUDE.md"
    unlink_item "$target/settings.json"
}

uninstall_forge() {
    local target="$HOME/forge"
    echo "  Target: $target"
    unlink_item "$target/skills"
    unlink_item "$target/agents"
    unlink_item "$target/AGENTS.md"
    unlink_item "$target/.forge.toml"
}

uninstall_opencode() {
    local target="$HOME/.config/opencode"
    echo "  Target: $target"
    unlink_item "$target/skills"
    unlink_item "$target/agents"
    unlink_item "$target/AGENTS.md"
    unlink_item "$target/opencode.json"
}

uninstall_codex() {
    local target="$HOME/.codex"
    echo "  Target: $target"
    unlink_children "$REPO_DIR/skills" "$target/skills"
    unlink_item "$target/agents"
    unlink_item "$target/AGENTS.md"
    unlink_item "$target/config.toml"
}

uninstall_droid() {
    local target="$HOME/.factory"
    echo "  Target: $target"
    unlink_children "$REPO_DIR/skills" "$target/skills"
    unlink_item "$target/AGENTS.md"
}

uninstall_pi() {
    local settings_file="${PI_SETTINGS_FILE:-$HOME/.pi/agent/settings.json}"
    local package_path="$REPO_DIR/packages/quality-autoresearch"
    echo "  Settings: $settings_file"

    if [ ! -e "$settings_file" ]; then
        echo "    SKIP settings.json (not found)"
        return
    fi

    SETTINGS_FILE="$settings_file" PACKAGE_PATH="$package_path" python - <<'PY'
import json
import os
from pathlib import Path

settings_path = Path(os.environ["SETTINGS_FILE"])
package_path = os.environ["PACKAGE_PATH"]
data = json.loads(settings_path.read_text()) if settings_path.read_text().strip() else {}
packages = data.get("packages", [])
if not isinstance(packages, list):
    raise SystemExit("settings.json field 'packages' exists but is not a list")
data["packages"] = [pkg for pkg in packages if pkg != package_path]
settings_path.write_text(json.dumps(data, indent=2) + "\n")
PY
    echo "    REMOVED quality-autoresearch package"
}

# ─────────────────────────────────────────────────────────────────────────────
# Helpers
# ─────────────────────────────────────────────────────────────────────────────

unlink_item() {
    local target="$1"
    local name
    name="$(basename "$target")"

    if [ -L "$target" ]; then
        rm "$target"
        echo "    REMOVED $name"

        # Restore most recent backup if one exists
        local backup
        backup=$(ls -t "$target".bak.* 2>/dev/null | head -1 || true)
        if [ -n "$backup" ]; then
            mv "$backup" "$target"
            echo "    RESTORED $name from $(basename "$backup")"
        fi
    elif [ -e "$target" ]; then
        echo "    SKIP $name (not a symlink, leaving alone)"
    else
        echo "    SKIP $name (not found)"
    fi
}

unlink_children() {
    local source_dir="$1"
    local target_dir="$2"
    local name
    local target
    local backup

    if [ ! -d "$source_dir" ]; then
        echo "    SKIP $(basename "$target_dir") (not in repo)"
        return
    fi

    if [ ! -d "$target_dir" ]; then
        echo "    SKIP $(basename "$target_dir") (not found)"
        return
    fi

    for source in "$source_dir"/*; do
        [ -e "$source" ] || continue
        name="$(basename "$source")"
        target="$target_dir/$name"

        if [ -L "$target" ]; then
            rm "$target"
            echo "    REMOVED $name"

            backup=$(ls -t "$(dirname "$target_dir")/$(basename "$target_dir")".bak.*/"$name" 2>/dev/null | head -1 || true)
            if [ -n "$backup" ]; then
                mv "$backup" "$target"
                echo "    RESTORED $name from $(basename "$(dirname "$backup")")"
            fi
        elif [ -e "$target" ]; then
            echo "    SKIP $name (not a symlink, leaving alone)"
        else
            echo "    SKIP $name (not found)"
        fi
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
    echo "  droid      Factory.ai Droid (~/.factory/)"
    echo "  pi         Pi packages (~/.pi/agent/settings.json)"
    echo "  all        All harnesses"
}

ALL_HARNESSES=(claude forge opencode codex droid pi)

# ─────────────────────────────────────────────────────────────────────────────
# Main
# ─────────────────────────────────────────────────────────────────────────────

echo "AI Coding Harness Uninstaller"
echo ""

SELECTED=()

if [ $# -eq 0 ]; then
    SELECTED=("${ALL_HARNESSES[@]}")
    echo "No harness specified, uninstalling all."
    echo ""
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
        claude|forge|opencode|codex|droid|pi)
            echo "Uninstalling $harness..."
            "uninstall_$harness"
            echo ""
            ;;
        *)
            echo "Unknown harness: $harness"
            usage
            exit 1
            ;;
    esac
done

echo "Done."
