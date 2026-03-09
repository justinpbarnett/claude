#!/bin/bash
set -euo pipefail

CLAUDE_DIR="$HOME/.claude"

ITEMS=(skills agents hooks rules CLAUDE.md settings.json)

echo "Removing claude-config symlinks from $CLAUDE_DIR"
echo ""

for item in "${ITEMS[@]}"; do
    target="$CLAUDE_DIR/$item"

    if [ -L "$target" ]; then
        rm "$target"
        echo "REMOVED $target"

        # Restore backup if one exists
        backup=$(ls -t "$target".bak.* 2>/dev/null | head -1)
        if [ -n "$backup" ]; then
            mv "$backup" "$target"
            echo "RESTORED $target from $backup"
        fi
    fi
done

echo ""
echo "Done."
