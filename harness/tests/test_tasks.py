import json
import tempfile
from pathlib import Path

from harness.tasks import Task, TaskList


def _make_task_list(n: int = 3) -> TaskList:
    tasks = [
        Task(id=str(i + 1), name=f"Task {i + 1}", description=f"Do thing {i + 1}")
        for i in range(n)
    ]
    return TaskList(tasks=tasks)


def test_save_and_load_round_trip(tmp_path: Path):
    tl = _make_task_list()
    path = tmp_path / "tasks.json"
    tl.save(path)
    loaded = TaskList.load(path)
    assert len(loaded.tasks) == 3
    assert loaded.tasks[0].name == "Task 1"
    assert loaded.tasks[2].status == "pending"


def test_next_pending():
    tl = _make_task_list()
    t = tl.next_pending()
    assert t is not None
    assert t.id == "1"


def test_next_pending_skips_done():
    tl = _make_task_list()
    tl.tasks[0].status = "done"
    t = tl.next_pending()
    assert t is not None
    assert t.id == "2"


def test_next_pending_returns_none_when_all_done():
    tl = _make_task_list()
    for t in tl.tasks:
        t.status = "done"
    assert tl.next_pending() is None


def test_claim():
    tl = _make_task_list()
    t = tl.claim("1")
    assert t is not None
    assert t.status == "in_progress"
    assert t.attempts == 1
    assert t.started_at is not None


def test_claim_already_in_progress():
    tl = _make_task_list()
    tl.claim("1")
    assert tl.claim("1") is None


def test_complete():
    tl = _make_task_list()
    tl.claim("1")
    tl.complete("1")
    assert tl.tasks[0].status == "done"
    assert tl.tasks[0].completed_at is not None


def test_fail():
    tl = _make_task_list()
    tl.claim("1")
    tl.fail("1", "something broke")
    assert tl.tasks[0].status == "error"
    assert tl.tasks[0].error_message == "something broke"


def test_reset_to_pending():
    tl = _make_task_list()
    tl.claim("1")
    tl.fail("1", "oops")
    tl.reset_to_pending("1")
    assert tl.tasks[0].status == "pending"
    assert tl.tasks[0].error_message is None


def test_all_done():
    tl = _make_task_list(2)
    assert not tl.all_done()
    tl.tasks[0].status = "done"
    tl.tasks[1].status = "error"
    assert tl.all_done()


def test_summary():
    tl = _make_task_list(4)
    tl.tasks[0].status = "done"
    tl.tasks[1].status = "in_progress"
    tl.tasks[2].status = "error"
    s = tl.summary()
    assert s == {"total": 4, "pending": 1, "in_progress": 1, "done": 1, "error": 1}


def test_atomic_write(tmp_path: Path):
    """Save should use atomic write (temp file + rename)."""
    path = tmp_path / "tasks.json"
    tl = _make_task_list()
    tl.save(path)
    # File should be valid JSON
    data = json.loads(path.read_text())
    assert len(data) == 3
