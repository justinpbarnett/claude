#!/bin/bash
set -euo pipefail

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

usage() {
    echo "Usage: $0 [harness|all]"
    echo ""
    echo "Harnesses:"
    echo "  claude     Claude Code (~/.claude/)"
    echo "  forge      ForgeCode   (~/forge/)"
    echo "  opencode   OpenCode    (~/.config/opencode/)"
    echo "  all        All harnesses"
}

ALL_HARNESSES=(claude forge opencode)

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
        claude|forge|opencode)
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
