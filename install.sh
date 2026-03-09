#!/bin/bash
set -euo pipefail

REPO_DIR="$(cd "$(dirname "$0")" && pwd)"
CLAUDE_DIR="$HOME/.claude"

echo "Installing claude-config from $REPO_DIR"
echo "Target: $CLAUDE_DIR"
echo ""

# Ensure ~/.claude exists
mkdir -p "$CLAUDE_DIR"

# Items to symlink
ITEMS=(skills agents hooks rules CLAUDE.md settings.json)

for item in "${ITEMS[@]}"; do
    target="$CLAUDE_DIR/$item"
    source="$REPO_DIR/$item"

    if [ ! -e "$source" ]; then
        echo "SKIP $item (not in repo)"
        continue
    fi

    # If target exists and is not a symlink, back it up
    if [ -e "$target" ] && [ ! -L "$target" ]; then
        backup="$target.bak.$(date +%Y%m%d%H%M%S)"
        echo "BACKUP $item -> $backup"
        mv "$target" "$backup"
    fi

    # Remove existing symlink if present
    if [ -L "$target" ]; then
        rm "$target"
    fi

    ln -s "$source" "$target"
    echo "LINK $item -> $source"
done

echo ""
echo "Done. Restart Claude Code to pick up changes."
