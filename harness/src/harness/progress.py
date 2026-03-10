from __future__ import annotations

import json
import tempfile
from dataclasses import dataclass, field, asdict
from datetime import datetime
from pathlib import Path


@dataclass
class IterationResult:
    task_id: str
    task_name: str
    status: str  # done, error
    cost_usd: float = 0.0
    duration_seconds: float = 0.0
    output_summary: str = ""
    error_message: str = ""


@dataclass
class Progress:
    iteration: int = 0
    total_cost: float = 0.0
    started_at: str = ""
    last_task: str = ""
    last_status: str = ""
    notes: str = ""
    history: list[dict] = field(default_factory=list)

    @classmethod
    def load(cls, path: Path) -> Progress:
        if not path.exists():
            return cls()
        with open(path) as f:
            data = json.load(f)
        return cls(**data)

    def save(self, path: Path) -> None:
        with tempfile.NamedTemporaryFile(
            mode="w", dir=path.parent, suffix=".tmp", delete=False
        ) as tmp:
            json.dump(asdict(self), tmp, indent=2)
            tmp.write("\n")
        Path(tmp.name).replace(path)

    def update(self, result: IterationResult) -> None:
        self.iteration += 1
        self.total_cost += result.cost_usd
        self.last_task = result.task_name
        self.last_status = result.status
        self.history.append({
            "iteration": self.iteration,
            "task_id": result.task_id,
            "task_name": result.task_name,
            "status": result.status,
            "cost_usd": result.cost_usd,
            "duration_seconds": result.duration_seconds,
            "timestamp": datetime.now().isoformat(),
        })
        if len(self.history) > 50:
            self.history = self.history[-50:]

    def format_for_prompt(self) -> str:
        lines = [
            f"Iteration: {self.iteration}",
            f"Total cost so far: ${self.total_cost:.4f}",
            f"Started: {self.started_at}",
        ]
        if self.last_task:
            lines.append(f"Last completed task: {self.last_task} ({self.last_status})")
        if self.notes:
            lines.append("")
            lines.append("Notes from last session:")
            lines.append(self.notes)
        if self.history:
            lines.append("")
            lines.append("Recent history:")
            for entry in self.history[-5:]:
                lines.append(
                    f"  - [{entry['status']}] {entry['task_name']} "
                    f"(${entry['cost_usd']:.4f})"
                )
        return "\n".join(lines)
