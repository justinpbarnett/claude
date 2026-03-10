#!/usr/bin/env bash
# post-edit-lint.sh -- PostToolUse hook for Write|Edit
# Runs project-appropriate linter after file edits and reports issues to Claude.
# - Go projects: go vet on the package
# - Next.js/Node projects: eslint on the file (if eslint is configured)

set -euo pipefail

INPUT=$(cat)
FILE_PATH=$(echo "$INPUT" | jq -r '.tool_input.file_path // empty' 2>/dev/null)

if [ -z "$FILE_PATH" ] || [ ! -f "$FILE_PATH" ]; then
  exit 0
fi

EXT="${FILE_PATH##*.}"

# Walk up to find project root
DIR=$(dirname "$FILE_PATH")
PROJECT_ROOT=""
while [ "$DIR" != "/" ]; do
  if [ -f "$DIR/go.mod" ] || [ -f "$DIR/package.json" ]; then
    PROJECT_ROOT="$DIR"
    break
  fi
  DIR=$(dirname "$DIR")
done

if [ -z "$PROJECT_ROOT" ]; then
  exit 0
fi

# Go project: run go vet on the package containing the file
if [ -f "$PROJECT_ROOT/go.mod" ] && [ "$EXT" = "go" ]; then
  PKG_DIR=$(dirname "$FILE_PATH")
  # Get the relative package path
  REL_PKG="${PKG_DIR#"$PROJECT_ROOT"}"
  if [ -z "$REL_PKG" ]; then
    REL_PKG="."
  else
    REL_PKG=".${REL_PKG}"
  fi
  cd "$PROJECT_ROOT"
  VET_OUTPUT=$(go vet "$REL_PKG" 2>&1) || true
  if [ -n "$VET_OUTPUT" ]; then
    jq -n --arg output "$VET_OUTPUT" --arg file "$FILE_PATH" '{
      hookSpecificOutput: {
        hookEventName: "PostToolUse",
        additionalContext: ("go vet found issues after editing " + $file + ":\n" + $output)
      }
    }'
    exit 0
  fi
fi

# Python project: run ruff on the specific file if available
if [ -f "$PROJECT_ROOT/pyproject.toml" ] || [ -f "$PROJECT_ROOT/setup.py" ]; then
  case "$EXT" in
    py)
      if command -v ruff &>/dev/null; then
        cd "$PROJECT_ROOT"
        LINT_OUTPUT=$(ruff check --no-fix "$FILE_PATH" 2>&1) || true
        if [ -n "$LINT_OUTPUT" ] && ! echo "$LINT_OUTPUT" | grep -q "All checks passed"; then
          ERROR_LINES=$(echo "$LINT_OUTPUT" | head -10)
          jq -n --arg output "$ERROR_LINES" --arg file "$FILE_PATH" '{
            hookSpecificOutput: {
              hookEventName: "PostToolUse",
              additionalContext: ("ruff found issues after editing " + $file + ":\n" + $output)
            }
          }'
          exit 0
        fi
      fi
      ;;
  esac
fi

# Node project: run eslint on the specific file if available
if [ -f "$PROJECT_ROOT/package.json" ]; then
  case "$EXT" in
    ts|tsx|js|jsx)
      if [ -f "$PROJECT_ROOT/node_modules/.bin/eslint" ]; then
        cd "$PROJECT_ROOT"
        LINT_OUTPUT=$(npx eslint --no-error-on-unmatched-pattern "$FILE_PATH" 2>&1) || true
        if echo "$LINT_OUTPUT" | grep -qE '(error|warning)'; then
          # Only report errors, not warnings, to avoid noise
          ERROR_LINES=$(echo "$LINT_OUTPUT" | grep -E 'error' | head -10)
          if [ -n "$ERROR_LINES" ]; then
            jq -n --arg output "$ERROR_LINES" --arg file "$FILE_PATH" '{
              hookSpecificOutput: {
                hookEventName: "PostToolUse",
                additionalContext: ("eslint found errors after editing " + $file + ":\n" + $output)
              }
            }'
            exit 0
          fi
        fi
      fi
      ;;
  esac
fi

exit 0
