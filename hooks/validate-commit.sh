#!/usr/bin/env bash
# validate-commit.sh -- PreToolUse hook for Bash
# Validates git commit messages:
# 1. Must use conventional commit format (feat:, fix:, refactor:, etc.)
# 2. Must not contain "claude", "ai", "copilot", "llm", "gpt", "chatgpt"
# 3. Must not contain emdashes

set -uo pipefail

INPUT=$(cat)
COMMAND=$(echo "$INPUT" | jq -r '.tool_input.command // empty' 2>/dev/null || true)

if [ -z "$COMMAND" ]; then
  exit 0
fi

# Only check git commit commands
if ! echo "$COMMAND" | grep -qE 'git\s+commit'; then
  exit 0
fi

# Skip if no -m flag (amend without message change, etc.)
if ! echo "$COMMAND" | grep -qE '\-m\s'; then
  exit 0
fi

# Extract the commit message
# Claude Code typically uses: git commit -m "$(cat <<'EOF'\n...\nEOF\n)"
# or simple: git commit -m "message"
MSG=""

# Strategy 1: heredoc content between EOF markers
if echo "$COMMAND" | grep -qE "cat <<"; then
  MSG=$(echo "$COMMAND" | sed -n '/EOF/,/EOF/p' | grep -v 'EOF' | grep -v ')"' | sed 's/^[[:space:]]*//' || true)
fi

# Strategy 2: simple -m "..." or -m '...'
if [ -z "$MSG" ]; then
  # Extract everything after -m and between quotes
  MSG=$(echo "$COMMAND" | sed -n 's/.*-m[[:space:]]*"\([^"]*\)".*/\1/p' || true)
fi
if [ -z "$MSG" ]; then
  MSG=$(echo "$COMMAND" | sed -n "s/.*-m[[:space:]]*'\([^']*\)'.*/\1/p" || true)
fi

# Strategy 3: -m followed by unquoted word(s) until next flag
if [ -z "$MSG" ]; then
  MSG=$(echo "$COMMAND" | sed -n 's/.*-m[[:space:]]*\([^-][^[:space:]]*\).*/\1/p' || true)
fi

if [ -z "$MSG" ]; then
  # Could not parse message, allow it through
  exit 0
fi

# Check for forbidden words (case-insensitive)
# Match "claude", "copilot", "llm", "chatgpt", "openai", "anthropic" anywhere
# Match "ai" only as a standalone word (not inside "repair", "maintain", etc.)
if echo "$MSG" | grep -iqE '\b(claude|copilot|llm|chatgpt|openai|anthropic)\b' 2>/dev/null; then
  echo "Commit message must not mention AI tools. Rephrase to describe what changed, not who changed it." >&2
  exit 2
fi
if echo "$MSG" | grep -iqE '\bai\b' 2>/dev/null; then
  echo "Commit message must not mention AI. Rephrase to describe what changed, not who changed it." >&2
  exit 2
fi
if echo "$MSG" | grep -iqE '\bgpt-[0-9]' 2>/dev/null; then
  echo "Commit message must not mention AI models. Rephrase to describe what changed, not who changed it." >&2
  exit 2
fi

# Check for emdashes (U+2014)
if echo "$MSG" | grep -qP '\xe2\x80\x94' 2>/dev/null || echo "$MSG" | grep -qF $'\xe2\x80\x94' 2>/dev/null; then
  echo "Commit message contains an emdash. Use a hyphen (-), comma, or period instead." >&2
  exit 2
fi

# Check conventional commit format
# First non-empty line should match: type(scope): description  or  type: description
FIRST_LINE=$(echo "$MSG" | grep -v '^$' | head -n1 | sed 's/^[[:space:]]*//')
if [ -n "$FIRST_LINE" ]; then
  if ! echo "$FIRST_LINE" | grep -qP '^(feat|fix|refactor|docs|test|chore|style|perf|ci|build|revert)(\(.+\))?(!)?:\s+\S'; then
    jq -n '{
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: "deny",
        permissionDecisionReason: "Commit message must use conventional commit format: type(scope): description. Valid types: feat, fix, refactor, docs, test, chore, style, perf, ci, build, revert"
      }
    }'
    exit 0
  fi
fi

exit 0
