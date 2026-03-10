from __future__ import annotations

import os

_cached_env: dict[str, str] | None = None


def clean_env() -> dict[str, str]:
    """Return a copy of the environment safe for spawning claude subprocesses."""
    global _cached_env
    if _cached_env is None:
        _cached_env = {k: v for k, v in os.environ.items() if k not in ("CLAUDECODE", "CLAUDE_CODE")}
    return _cached_env
