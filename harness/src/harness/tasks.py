from __future__ import annotations

import fcntl
import json
import tempfile
from dataclasses import dataclass, field, asdict
from datetime import datetime
from pathlib import Path


@dataclass
class Task:
    id: str
    name: str
    description: str
    status: str = "pending"  # pending, in_progress, done, error
    verify: str | None = None  # shell command to verify task completion
    error_message: str | None = None
    attempts: int = 0
    started_at: str | None = None
    completed_at: str | None = None


@dataclass
class TaskList:
    tasks: list[Task] = field(default_factory=list)

    @classmethod
    def load(cls, path: Path) -> TaskList:
        with open(path) as f:
            fcntl.flock(f, fcntl.LOCK_SH)
            try:
                data = json.load(f)
            finally:
                fcntl.flock(f, fcntl.LOCK_UN)
        tasks = [Task(**t) for t in data]
        return cls(tasks=tasks)

    def save(self, path: Path) -> None:
        data = [asdict(t) for t in self.tasks]
        dir_path = path.parent
        with tempfile.NamedTemporaryFile(
            mode="w", dir=dir_path, suffix=".tmp", delete=False
        ) as tmp:
            fcntl.flock(tmp, fcntl.LOCK_EX)
            try:
                json.dump(data, tmp, indent=2)
                tmp.write("\n")
            finally:
                fcntl.flock(tmp, fcntl.LOCK_UN)
        Path(tmp.name).replace(path)

    def next_pending(self) -> Task | None:
        for t in self.tasks:
            if t.status == "pending":
                return t
        return None

    def claim(self, task_id: str) -> Task | None:
        for t in self.tasks:
            if t.id == task_id and t.status == "pending":
                t.status = "in_progress"
                t.attempts += 1
                t.started_at = datetime.now().isoformat()
                return t
        return None

    def complete(self, task_id: str) -> None:
        for t in self.tasks:
            if t.id == task_id:
                t.status = "done"
                t.completed_at = datetime.now().isoformat()
                return

    def fail(self, task_id: str, error: str) -> None:
        for t in self.tasks:
            if t.id == task_id:
                t.status = "error"
                t.error_message = error
                t.completed_at = datetime.now().isoformat()
                return

    def reset_to_pending(self, task_id: str) -> None:
        for t in self.tasks:
            if t.id == task_id:
                t.status = "pending"
                t.error_message = None
                return

    def all_done(self) -> bool:
        return all(t.status in ("done", "error") for t in self.tasks)

    def summary(self) -> dict:
        counts = {"pending": 0, "in_progress": 0, "done": 0, "error": 0}
        for t in self.tasks:
            counts[t.status] = counts.get(t.status, 0) + 1
        return {
            "total": len(self.tasks),
            **counts,
        }
