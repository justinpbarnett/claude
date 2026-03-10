from pathlib import Path

from harness.progress import IterationResult, Progress


def test_default_progress():
    p = Progress()
    assert p.iteration == 0
    assert p.total_cost == 0.0
    assert p.history == []


def test_save_and_load(tmp_path: Path):
    p = Progress(iteration=3, total_cost=1.5, started_at="2026-01-01T00:00:00")
    path = tmp_path / "progress.json"
    p.save(path)
    loaded = Progress.load(path)
    assert loaded.iteration == 3
    assert loaded.total_cost == 1.5


def test_load_missing_file(tmp_path: Path):
    p = Progress.load(tmp_path / "nope.json")
    assert p.iteration == 0


def test_update():
    p = Progress()
    result = IterationResult(
        task_id="1",
        task_name="Setup DB",
        status="done",
        cost_usd=0.05,
        duration_seconds=30.0,
    )
    p.update(result)
    assert p.iteration == 1
    assert p.total_cost == 0.05
    assert p.last_task == "Setup DB"
    assert p.last_status == "done"
    assert len(p.history) == 1


def test_update_accumulates_cost():
    p = Progress()
    for i in range(3):
        p.update(IterationResult(
            task_id=str(i),
            task_name=f"Task {i}",
            status="done",
            cost_usd=0.10,
        ))
    assert abs(p.total_cost - 0.30) < 1e-9
    assert p.iteration == 3


def test_format_for_prompt():
    p = Progress(
        iteration=2,
        total_cost=0.15,
        started_at="2026-01-01T00:00:00",
        last_task="Add routes",
        last_status="done",
    )
    text = p.format_for_prompt()
    assert "Iteration: 2" in text
    assert "$0.1500" in text
    assert "Add routes" in text


def test_format_for_prompt_with_history():
    p = Progress(iteration=1, total_cost=0.05, started_at="2026-01-01")
    p.history = [
        {"iteration": 1, "task_id": "1", "task_name": "Init", "status": "done", "cost_usd": 0.05},
    ]
    text = p.format_for_prompt()
    assert "Recent history:" in text
    assert "Init" in text
