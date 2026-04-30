#!/usr/bin/env -S uv run --script
# /// script
# requires-python = ">=3.11"
# dependencies = []
# ///
"""DO NOT EDIT DURING AUTORESEARCH.

Generic Code Quality Penalty evaluator for pi-autoresearch.
Reads .autoresearch/quality/config.json and emits METRIC lines.
"""

from __future__ import annotations

import json
import re
import subprocess
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Any

ROOT = Path.cwd()
CONFIG_PATH = ROOT / ".autoresearch" / "quality" / "config.json"


@dataclass
class CheckerResult:
    checker_id: str
    findings: float
    penalty: float
    exit_code: int


def load_config() -> dict[str, Any]:
    if not CONFIG_PATH.exists():
        raise SystemExit(f"Missing quality config: {CONFIG_PATH}")
    return json.loads(CONFIG_PATH.read_text())


def run_checker(command: str) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        command,
        shell=True,
        cwd=ROOT,
        text=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        timeout=300,
    )


def parse_metric_lines(output: str, metric_name: str | None = None) -> float:
    values: list[float] = []
    pattern = re.compile(r"^METRIC\s+([A-Za-z_][\w-]*)=([-+]?\d+(?:\.\d+)?)\s*$")
    for line in output.splitlines():
        match = pattern.match(line.strip())
        if not match:
            continue
        name, raw = match.groups()
        if metric_name is None or name == metric_name:
            values.append(float(raw))
    return sum(values)


def parse_findings(checker: dict[str, Any], completed: subprocess.CompletedProcess[str]) -> float:
    parser = checker.get("parser", "exit-code")
    output = completed.stdout or ""

    if parser == "metric-lines":
        metric_name = checker.get("metric") or checker.get("metricName")
        return parse_metric_lines(output, metric_name)

    if parser == "regex-count":
        pattern = checker.get("pattern")
        if not pattern:
            raise ValueError(f"Checker {checker.get('id')} uses regex-count without pattern")
        return float(len(re.findall(pattern, output, flags=re.MULTILINE)))

    # Conservative generic fallback. Rich tool-specific parsers can be added
    # without changing the config contract.
    if parser in {
        "exit-code",
        "pytest",
        "ruff",
        "mypy",
        "pyright",
        "eslint",
        "tsc",
        "radon-cc",
        "bandit",
        "interrogate",
    }:
        return 0.0 if completed.returncode == 0 else 1.0

    raise ValueError(f"Unsupported parser: {parser}")


def evaluate_checker(checker: dict[str, Any]) -> CheckerResult:
    checker_id = checker["id"]
    completed = run_checker(checker["command"])
    findings = parse_findings(checker, completed)
    penalty = findings * float(checker.get("weight", 1))
    if findings > 0:
        penalty += float(checker.get("anyFailurePenalty", 0))
    return CheckerResult(checker_id, findings, penalty, completed.returncode)


def main() -> int:
    config = load_config()
    results: list[CheckerResult] = []
    total = 0.0

    for checker in config.get("checkers", []):
        try:
            result = evaluate_checker(checker)
        except Exception as exc:  # keep failures expensive and visible
            checker_id = checker.get("id", "unknown")
            print(f"Checker {checker_id} crashed: {exc}", file=sys.stderr)
            result = CheckerResult(checker_id, 1.0, float(checker.get("crashPenalty", 10000)), 1)
        results.append(result)
        total += result.penalty

    print(f"Code Quality Penalty: {total:.3f}")
    print(f"METRIC cqp={total:.3f}")
    for result in results:
        safe_id = re.sub(r"\W+", "_", result.checker_id).strip("_")
        print(f"METRIC {safe_id}_findings={result.findings:.3f}")
        print(f"METRIC {safe_id}_penalty={result.penalty:.3f}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
