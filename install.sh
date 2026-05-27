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
    link "$REPO_DIR/harness/claude/settings.json" "$target/settings.json"
}

install_forge() {
    local target="$HOME/forge"
    echo "  Target: $target"
    mkdir -p "$target"

    link "$REPO_DIR/skills"                    "$target/skills"
    link "$REPO_DIR/harness/forge/.forge.toml" "$target/.forge.toml"
}

install_opencode() {
    local target="$HOME/.config/opencode"
    echo "  Target: $target"
    mkdir -p "$target"

    link "$REPO_DIR/skills"                         "$target/skills"
    link "$REPO_DIR/harness/opencode/opencode.json" "$target/opencode.json"
}

install_codex() {
    local target="$HOME/.codex"
    echo "  Target: $target"
    mkdir -p "$target"

    link_children "$REPO_DIR/skills"           "$target/skills"
    link "$REPO_DIR/harness/codex/config.toml" "$target/config.toml"
}

install_droid() {
    local target="$HOME/.factory"
    echo "  Target: $target"
    mkdir -p "$target"

    link_children "$REPO_DIR/skills" "$target/skills"
}

install_pi() {
    local target="$HOME/.pi/agent"
    echo "  Target: $target"
    mkdir -p "$target"

    link "$REPO_DIR/skills"                           "$target/skills"
    link "$REPO_DIR/pi-config/settings.json"          "$target/settings.json"
    link "$REPO_DIR/pi-config/models.json"            "$target/models.json"
    link "$REPO_DIR/pi-config/keybindings.json"       "$target/keybindings.json"
    link "$REPO_DIR/pi-config/autoresearch.config.json" "$target/autoresearch.config.json"
    link "$REPO_DIR/pi-config/extensions"             "$target/extensions"
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

    for target in "$target_dir"/*; do
        [ -e "$target" ] || continue
        [ -L "$target" ] || continue
        link_dest="$(readlink "$target")"
        case "$link_dest" in
            "$source_dir"/*)
                if [ ! -e "$link_dest" ]; then
                    echo "    REMOVED stale $(basename "$target") -> $link_dest"
                    rm "$target"
                fi
                ;;
        esac
    done

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
    echo "  droid      Factory.ai Droid (~/.factory/)"
    echo "  pi         Pi packages (~/.pi/agent/settings.json)"
    echo "  all        All harnesses"
    echo ""
    echo "Examples:"
    echo "  $0 claude          # Install Claude Code only"
    echo "  $0 forge opencode  # Install Forge and OpenCode"
    echo "  $0 all             # Install all harnesses"
    echo "  $0                 # Interactive: select harnesses"
}

ALL_HARNESSES=(claude forge opencode codex droid pi)

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
        claude|forge|opencode|codex|droid|pi)
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
