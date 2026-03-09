#!/usr/bin/env bash
# check-emdash.sh -- PostToolUse hook for Write|Edit
# Checks if a written/edited file contains emdashes and warns Claude.
# Only checks user-facing content files (not code logic, configs, etc.)

set -euo pipefail

INPUT=$(cat)
FILE_PATH=$(echo "$INPUT" | jq -r '.tool_input.file_path // empty' 2>/dev/null)

if [ -z "$FILE_PATH" ] || [ ! -f "$FILE_PATH" ]; then
  exit 0
fi

EXT="${FILE_PATH##*.}"

# Only check files likely to contain user-facing content
case "$EXT" in
  md|mdx|txt|tsx|jsx|html|svelte|vue)
    ;;
  *)
    exit 0
    ;;
esac

# Check for emdash (U+2014: UTF-8 bytes E2 80 94)
if grep -qP '\x{2014}' "$FILE_PATH" 2>/dev/null || grep -qF $'\xe2\x80\x94' "$FILE_PATH" 2>/dev/null; then
  # Find the lines with emdashes
  LINES=$(grep -nF $'\xe2\x80\x94' "$FILE_PATH" 2>/dev/null | head -5)
  jq -n --arg lines "$LINES" --arg path "$FILE_PATH" '{
    decision: "block",
    reason: ("File " + $path + " contains emdashes (U+2014). Replace them with hyphens, commas, or periods. Lines:\n" + $lines)
  }'
  exit 0
fi

exit 0
