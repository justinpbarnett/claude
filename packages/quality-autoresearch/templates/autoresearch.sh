#!/bin/bash
set -euo pipefail
uv run --script .autoresearch/quality/evaluate_quality.py
