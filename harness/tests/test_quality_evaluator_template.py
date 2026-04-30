import json
import subprocess
import sys
from pathlib import Path


REPO = Path(__file__).resolve().parents[2]
TEMPLATE = REPO / "packages" / "quality-autoresearch" / "templates" / "evaluate_quality.py"


def run_evaluator(tmp_path: Path, config: dict) -> str:
    quality_dir = tmp_path / ".autoresearch" / "quality"
    quality_dir.mkdir(parents=True)
    (quality_dir / "evaluate_quality.py").write_text(TEMPLATE.read_text())
    (quality_dir / "config.json").write_text(json.dumps(config))
    result = subprocess.run(
        [sys.executable, str(quality_dir / "evaluate_quality.py")],
        cwd=tmp_path,
        text=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        check=True,
    )
    return result.stdout


def test_evaluator_aggregates_metric_lines_and_regex_count(tmp_path):
    (tmp_path / "emit_metrics.py").write_text('print("METRIC findings=2")\n')
    (tmp_path / "emit_text.py").write_text('print("ERR one")\nprint("ok")\nprint("ERR two")\n')
    config = {
        "profile": "quality-cqp",
        "metric": "cqp",
        "checkers": [
            {
                "id": "custom_metric",
                "category": "custom",
                "command": f"{sys.executable} emit_metrics.py",
                "parser": "metric-lines",
                "metric": "findings",
                "weight": 10,
            },
            {
                "id": "regex",
                "category": "custom",
                "command": f"{sys.executable} emit_text.py",
                "parser": "regex-count",
                "pattern": "^ERR",
                "weight": 3,
            },
        ],
    }

    output = run_evaluator(tmp_path, config)

    assert "METRIC cqp=26.000" in output
    assert "METRIC custom_metric_findings=2.000" in output
    assert "METRIC regex_findings=2.000" in output


def test_evaluator_makes_crashed_checkers_expensive_and_visible(tmp_path):
    config = {
        "profile": "quality-cqp",
        "metric": "cqp",
        "checkers": [
            {
                "id": "bad_regex",
                "category": "custom",
                "command": f"{sys.executable} -c 'print(1)'",
                "parser": "regex-count",
                "weight": 1,
                "crashPenalty": 1234,
            }
        ],
    }

    output = run_evaluator(tmp_path, config)

    assert "METRIC cqp=1234.000" in output
    assert "METRIC bad_regex_penalty=1234.000" in output
