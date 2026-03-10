from __future__ import annotations

import subprocess
from dataclasses import dataclass
from pathlib import Path

from harness.subprocess_env import clean_env


@dataclass
class VerifyResult:
    passed: bool
    command: str
    stdout: str = ""
    stderr: str = ""
    exit_code: int = 0


def run_verify(command: str, project_dir: Path, timeout: int = 60) -> VerifyResult:
    """Run a verification command and return the result."""
    try:
        result = subprocess.run(
            ["bash", "-c", command],
            cwd=project_dir,
            capture_output=True,
            text=True,
            timeout=timeout,
            env=clean_env(),
        )
        return VerifyResult(
            passed=result.returncode == 0,
            command=command,
            stdout=result.stdout[:1000],
            stderr=result.stderr[:1000],
            exit_code=result.returncode,
        )
    except subprocess.TimeoutExpired:
        return VerifyResult(
            passed=False,
            command=command,
            stderr=f"Verification timed out after {timeout}s",
            exit_code=-1,
        )
