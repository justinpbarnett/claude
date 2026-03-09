#!/usr/bin/env bash
# auto-format.sh -- PostToolUse hook for Write|Edit
# Auto-formats files after Claude writes or edits them.
# Detects project type and runs the appropriate formatter:
# - Go projects (go.mod): gofmt
# - Node/Next.js (package.json + prettier): npx prettier
# - Falls back to no-op for unknown projects

set -euo pipefail

INPUT=$(cat)
FILE_PATH=$(echo "$INPUT" | jq -r '.tool_input.file_path // empty' 2>/dev/null)

if [ -z "$FILE_PATH" ] || [ ! -f "$FILE_PATH" ]; then
  exit 0
fi

# Get the file extension
EXT="${FILE_PATH##*.}"

# Walk up to find project root by looking for common markers
DIR=$(dirname "$FILE_PATH")
PROJECT_ROOT=""
while [ "$DIR" != "/" ]; do
  if [ -f "$DIR/go.mod" ] || [ -f "$DIR/package.json" ] || [ -f "$DIR/Makefile" ] || [ -f "$DIR/justfile" ]; then
    PROJECT_ROOT="$DIR"
    break
  fi
  DIR=$(dirname "$DIR")
done

if [ -z "$PROJECT_ROOT" ]; then
  exit 0
fi

# Go project
if [ -f "$PROJECT_ROOT/go.mod" ]; then
  case "$EXT" in
    go)
      if command -v gofmt &>/dev/null; then
        gofmt -w "$FILE_PATH" 2>/dev/null || true
      fi
      ;;
  esac
  exit 0
fi

# Node/Next.js project
if [ -f "$PROJECT_ROOT/package.json" ]; then
  case "$EXT" in
    ts|tsx|js|jsx|json|css|html|md|yaml|yml)
      # Check if prettier is available in the project
      if [ -f "$PROJECT_ROOT/node_modules/.bin/prettier" ]; then
        cd "$PROJECT_ROOT"
        npx prettier --write "$FILE_PATH" 2>/dev/null || true
      fi
      ;;
  esac
  exit 0
fi

exit 0
