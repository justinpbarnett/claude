#!/usr/bin/env bash
# track-commits.sh -- PostToolUse hook for Bash
# Tracks recent git commits in project memory.
# Appends a one-line entry with commit message and date to:
#   ~/.claude/projects/{project-path}/memory/recent-commits.md
# Keeps only the last 20 entries.

set -uo pipefail

INPUT=$(cat)
COMMAND=$(echo "$INPUT" | jq -r '.tool_input.command // empty' 2>/dev/null || true)

if [ -z "$COMMAND" ]; then
  exit 0
fi

# Only act on git commit commands
if ! echo "$COMMAND" | grep -qE 'git\s+commit'; then
  exit 0
fi

# Get the working directory from the hook input
CWD=$(echo "$INPUT" | jq -r '.cwd // empty' 2>/dev/null || true)
if [ -z "$CWD" ]; then
  exit 0
fi

# Extract the commit message
MSG=""

# Strategy 1: heredoc content between EOF markers
if echo "$COMMAND" | grep -qE "cat <<"; then
  MSG=$(echo "$COMMAND" | sed -n '/EOF/,/EOF/p' | grep -v 'EOF' | grep -v ')"' | sed 's/^[[:space:]]*//' || true)
fi

# Strategy 2: simple -m "..." or -m '...'
if [ -z "$MSG" ]; then
  MSG=$(echo "$COMMAND" | sed -n 's/.*-m[[:space:]]*"\([^"]*\)".*/\1/p' || true)
fi
if [ -z "$MSG" ]; then
  MSG=$(echo "$COMMAND" | sed -n "s/.*-m[[:space:]]*'\([^']*\)'.*/\1/p" || true)
fi

if [ -z "$MSG" ]; then
  # Could not parse message, skip tracking
  exit 0
fi

# Collapse multi-line message to first line
MSG=$(echo "$MSG" | grep -v '^$' | head -n1 | sed 's/^[[:space:]]*//')

if [ -z "$MSG" ]; then
  exit 0
fi

# Build the project path: replace / with - and strip leading -
PROJECT_PATH=$(echo "$CWD" | tr '/' '-' | sed 's/^-//')
MEMORY_DIR="$HOME/.claude/projects/-${PROJECT_PATH}/memory"
MEMORY_FILE="$MEMORY_DIR/recent-commits.md"

# Ensure the memory directory exists
mkdir -p "$MEMORY_DIR"

# Append the new entry
DATE=$(date '+%Y-%m-%d')
echo "- ${DATE}: ${MSG}" >> "$MEMORY_FILE"

# Trim to last 20 entries
if [ -f "$MEMORY_FILE" ]; then
  LINES=$(wc -l < "$MEMORY_FILE")
  if [ "$LINES" -gt 20 ]; then
    TAIL_LINES=$((LINES - 20))
    # Use a temp file to avoid clobbering
    TMPFILE=$(mktemp)
    tail -n 20 "$MEMORY_FILE" > "$TMPFILE"
    mv "$TMPFILE" "$MEMORY_FILE"
  fi
fi

# Output nothing -- "allow" for PostToolUse
exit 0
