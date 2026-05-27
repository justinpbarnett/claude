#!/bin/bash
set -euo pipefail

# Thin wrapper around the Python installer (the real implementation lives in install.py).
# This preserves the familiar `./install.sh all` UX while keeping all logic in one place.

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

exec python3 "$SCRIPT_DIR/install.py" "$@"
