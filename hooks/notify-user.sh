#!/usr/bin/env bash
# Sends a desktop notification when Claude needs user input.
# Used by the Stop and Notification hooks.

TITLE="Claude Code"
INPUT="$(cat)"

PREVIEW="$(echo "$INPUT" | python3 -c "
import sys, json
data = json.load(sys.stdin)
msg = data.get('last_assistant_message', '') or data.get('message', '') or 'Waiting for your response'
msg = ' '.join(msg.split())
print(msg[:120])
" 2>/dev/null)"

MSG="${PREVIEW:-Waiting for your response}"

case "$(uname)" in
  Darwin)
    osascript -e "display notification \"$MSG\" with title \"$TITLE\" sound name \"Ping\""
    ;;
  Linux)
    if command -v notify-send &>/dev/null; then
      notify-send "$TITLE" "$MSG"
    fi
    ;;
esac
