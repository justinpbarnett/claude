from __future__ import annotations

import json
import subprocess
import sys
from datetime import datetime
from pathlib import Path

from harness.prompts import load_prompt
from harness.subprocess_env import clean_env
from harness.tasks import Task, TaskList
from harness.progress import Progress


def initialize(
    project_dir: Path,
    spec: Path | None = None,
    prompt: str | None = None,
    model: str | None = None,
) -> TaskList:
    if spec:
        spec_content = spec.read_text()
        user_input = f"Here is the specification to break into tasks:\n\n{spec_content}"
    elif prompt:
        user_input = f"Here is what to build:\n\n{prompt}"
    else:
        raise ValueError("Either --spec or --prompt is required")

    system_prompt = load_prompt("initializer.md")
    full_prompt = f"{system_prompt}\n\n---\n\n{user_input}"

    task_list = _generate_tasks(full_prompt, project_dir, model)

    tasks_path = project_dir / "tasks.json"
    task_list.save(tasks_path)

    progress = Progress(started_at=datetime.now().isoformat())
    progress.save(project_dir / "progress.json")

    _git_commit_init(project_dir)

    return task_list


def _generate_tasks(
    prompt: str, project_dir: Path, model: str | None
) -> TaskList:
    cmd = [
        "claude",
        "-p", prompt,
        "--output-format", "json",
        "--max-turns", "3",
        "--dangerously-skip-permissions",
    ]
    if model:
        cmd.extend(["--model", model])

    try:
        result = subprocess.run(
            cmd,
            cwd=project_dir,
            capture_output=True,
            text=True,
            timeout=600,
            env=clean_env(),
        )
    except subprocess.TimeoutExpired:
        raise RuntimeError("claude -p timed out after 600 seconds during initialization")

    if result.returncode != 0:
        print(f"Error from claude: {result.stderr}", file=sys.stderr)
        raise RuntimeError(f"claude -p failed with exit code {result.returncode}")

    raw_output = result.stdout.strip()
    task_data = _extract_task_json(raw_output)

    tasks = []
    for item in task_data:
        tasks.append(Task(
            id=str(item["id"]),
            name=item["name"],
            description=item["description"],
            verify=item.get("verify"),
        ))

    return TaskList(tasks=tasks)


def _extract_task_json(raw: str) -> list[dict]:
    # claude -p --output-format json wraps the response in a JSON envelope
    try:
        envelope = json.loads(raw)
        if isinstance(envelope, dict) and "result" in envelope:
            text = envelope["result"]
        elif isinstance(envelope, dict) and "content" in envelope:
            text = envelope["content"]
        else:
            text = raw
    except json.JSONDecodeError:
        text = raw

    # The model's output may be a raw JSON array or wrapped in markdown fences
    text = text.strip()
    if text.startswith("```"):
        lines = text.split("\n")
        lines = [l for l in lines if not l.strip().startswith("```")]
        text = "\n".join(lines).strip()

    try:
        data = json.loads(text)
        if isinstance(data, list):
            return data
    except json.JSONDecodeError:
        pass

    # Try to find a JSON array in the text
    start = text.find("[")
    end = text.rfind("]")
    if start != -1 and end != -1:
        try:
            return json.loads(text[start:end + 1])
        except json.JSONDecodeError:
            pass

    raise RuntimeError(
        f"Could not extract task list JSON from claude output. Raw output:\n{text[:500]}"
    )


def _git_commit_init(project_dir: Path) -> None:
    subprocess.run(
        ["git", "add", "tasks.json", "progress.json"],
        cwd=project_dir,
        capture_output=True,
    )
    subprocess.run(
        ["git", "commit", "-m", "chore: initialize task list from spec"],
        cwd=project_dir,
        capture_output=True,
    )
