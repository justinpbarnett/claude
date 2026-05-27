#!/bin/bash
set -euo pipefail

# Thin wrapper around the Python installer.
# Calls with --uninstall flag.

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

exec python3 "$SCRIPT_DIR/install.py" --uninstall "$@"
