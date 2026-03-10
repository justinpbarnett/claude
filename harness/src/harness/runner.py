from __future__ import annotations

import json
import subprocess
import sys
import time
from concurrent.futures import ProcessPoolExecutor, as_completed
from dataclasses import dataclass, field
from pathlib import Path

from harness.notify import Notifier
from harness.progress import IterationResult, Progress
from harness.prompts import load_prompt
from harness.subprocess_env import clean_env
from harness.tasks import TaskList, Task
from harness.verify import run_verify


@dataclass
class RunConfig:
    project_dir: Path
    max_iterations: int | None = None
    max_cost: float | None = None
    on_failure: str = "pause"  # pause or skip
    parallel: int = 1
    model: str | None = None
    notifier: Notifier | None = None


def run_loop(config: RunConfig) -> None:
    tasks_path = config.project_dir / "tasks.json"
    progress_path = config.project_dir / "progress.json"

    if not tasks_path.exists():
        print("No tasks.json found. Run 'harness init' first.", file=sys.stderr)
        sys.exit(1)

    task_list = TaskList.load(tasks_path)
    progress = Progress.load(progress_path)

    # Reset any tasks stuck in_progress from a previous crash
    stale = [t for t in task_list.tasks if t.status == "in_progress"]
    if stale:
        for t in stale:
            task_list.reset_to_pending(t.id)
            print(f"  Reset stale in_progress task: {t.name}")
        task_list.save(tasks_path)

    notifier = config.notifier or Notifier(desktop=False)

    s = task_list.summary()
    print(f"Starting run loop. {s['total']} tasks: {s['done']} done, {s['pending']} pending, {s['error']} errors")

    try:
        if config.parallel > 1:
            _run_parallel(config, task_list, progress, tasks_path, progress_path, notifier)
        else:
            _run_sequential(config, task_list, progress, tasks_path, progress_path, notifier)
    except KeyboardInterrupt:
        print("\nInterrupted. Saving state...")
        task_list.save(tasks_path)
        progress.save(progress_path)
        notifier.send("Harness interrupted", "Saved state before exit.", "interrupted")
        sys.exit(130)

    summary = task_list.summary()
    msg = (
        f"Run complete. {summary['done']}/{summary['total']} done, "
        f"{summary['error']} errors, ${progress.total_cost:.4f} total cost"
    )
    print(msg)
    notifier.send("Harness complete", msg, "loop_complete")


def _should_stop(config: RunConfig, task_list: TaskList, progress: Progress) -> str | None:
    if task_list.all_done():
        return "all tasks done"
    if config.max_iterations and progress.iteration >= config.max_iterations:
        return f"max iterations ({config.max_iterations}) reached"
    if config.max_cost and progress.total_cost >= config.max_cost:
        return f"cost ceiling (${config.max_cost:.2f}) reached"
    return None


def _run_sequential(
    config: RunConfig,
    task_list: TaskList,
    progress: Progress,
    tasks_path: Path,
    progress_path: Path,
    notifier: Notifier,
) -> None:
    while True:
        stop_reason = _should_stop(config, task_list, progress)
        if stop_reason:
            print(f"Stopping: {stop_reason}")
            notifier.send("Harness stopped", stop_reason, "loop_stopped")
            break

        task = task_list.next_pending()
        if not task:
            print("No more pending tasks.")
            break

        task_list.claim(task.id)
        task_list.save(tasks_path)

        print(f"\n--- Iteration {progress.iteration + 1}: {task.name} ---")

        result = _run_iteration(config, task, progress)

        if result.status == "done":
            task_list.complete(task.id)
            print(f"  Completed: {task.name} (${result.cost_usd:.4f})")
        else:
            # Retry once
            print(f"  Failed: {result.error_message}. Retrying...")
            task_list.reset_to_pending(task.id)
            task_list.claim(task.id)
            retry_result = _run_iteration(config, task, progress, retry_context=result.error_message)

            if retry_result.status == "done":
                task_list.complete(task.id)
                result = retry_result
                print(f"  Completed on retry: {task.name} (${result.cost_usd:.4f})")
            else:
                task_list.fail(task.id, retry_result.error_message)
                result = retry_result
                print(f"  Failed after retry: {retry_result.error_message}")

                if config.on_failure == "pause":
                    task_list.save(tasks_path)
                    progress.update(result)
                    progress.save(progress_path)
                    notifier.send(
                        "Harness paused",
                        f"Task '{task.name}' failed: {result.error_message}",
                        "task_failed",
                    )
                    print("Pausing. Fix the issue and run again.")
                    return

        progress.update(result)
        task_list.save(tasks_path)
        progress.save(progress_path)


def _run_parallel(
    config: RunConfig,
    task_list: TaskList,
    progress: Progress,
    tasks_path: Path,
    progress_path: Path,
    notifier: Notifier,
) -> None:
    while True:
        stop_reason = _should_stop(config, task_list, progress)
        if stop_reason:
            print(f"Stopping: {stop_reason}")
            notifier.send("Harness stopped", stop_reason, "loop_stopped")
            break

        pending = [t for t in task_list.tasks if t.status == "pending"]
        if not pending:
            break

        batch = pending[:config.parallel]
        for t in batch:
            task_list.claim(t.id)
        task_list.save(tasks_path)

        print(f"\n--- Parallel batch: {[t.name for t in batch]} ---")

        with ProcessPoolExecutor(max_workers=config.parallel) as executor:
            futures = {
                executor.submit(_run_iteration_standalone, config, t, progress): t
                for t in batch
            }
            for future in as_completed(futures):
                task = futures[future]
                try:
                    result = future.result()
                except Exception as e:
                    result = IterationResult(
                        task_id=task.id,
                        task_name=task.name,
                        status="error",
                        error_message=str(e),
                    )

                if result.status == "done":
                    task_list.complete(task.id)
                    print(f"  Completed: {task.name}")
                else:
                    task_list.fail(task.id, result.error_message)
                    print(f"  Failed: {task.name} -- {result.error_message}")
                    if config.on_failure == "pause":
                        notifier.send(
                            "Harness paused",
                            f"Task '{task.name}' failed",
                            "task_failed",
                        )

                progress.update(result)

        task_list.save(tasks_path)
        progress.save(progress_path)

        if config.on_failure == "pause":
            has_errors = any(t.status == "error" for t in batch)
            if has_errors:
                print("Pausing due to failure in batch.")
                return


def _run_iteration_standalone(config: RunConfig, task: Task, progress: Progress) -> IterationResult:
    """Standalone function for ProcessPoolExecutor (must be picklable)."""
    return _run_iteration(config, task, progress)


def _run_iteration(
    config: RunConfig,
    task: Task,
    progress: Progress,
    retry_context: str | None = None,
) -> IterationResult:
    coding_template = load_prompt("coding.md")
    verify_section = ""
    if task.verify:
        verify_section = (
            f"## Verification\n\n"
            f"After implementation, this command will be run to verify your work:\n"
            f"```\n{task.verify}\n```\n"
            f"Make sure your implementation passes this check."
        )
    prompt = coding_template.format(
        iteration=progress.iteration + 1,
        task_description=f"## Task: {task.name}\n\n{task.description}",
        verify_section=verify_section,
        progress_context=progress.format_for_prompt(),
    )

    if retry_context:
        prompt += (
            f"\n\n## Retry Context\n\n"
            f"The previous attempt at this task failed with:\n{retry_context}\n\n"
            f"Please try a different approach or fix the issue."
        )

    cmd = [
        "claude",
        "-p", prompt,
        "--output-format", "json",
        "--dangerously-skip-permissions",
    ]
    if config.model:
        cmd.extend(["--model", config.model])

    def _error(msg, cost=0.0, dur=0.0):
        return IterationResult(
            task_id=task.id, task_name=task.name, status="error",
            cost_usd=cost, duration_seconds=dur, error_message=msg,
        )

    start_time = time.time()
    try:
        result = subprocess.run(
            cmd,
            cwd=config.project_dir,
            capture_output=True,
            text=True,
            timeout=600,
            env=clean_env(),
        )
    except subprocess.TimeoutExpired:
        return _error("Timed out after 600 seconds", dur=600)

    duration = time.time() - start_time
    parsed = _parse_claude_output(result.stdout)

    if result.returncode != 0:
        return _error(f"Exit code {result.returncode}: {result.stderr[:500]}", parsed.cost, duration)

    if parsed.permission_denials:
        return _error(f"Permission denied for: {', '.join(parsed.permission_denials)}", parsed.cost, duration)

    if task.verify:
        vr = run_verify(task.verify, config.project_dir)
        if not vr.passed:
            error_detail = vr.stderr.strip() or vr.stdout.strip() or f"exit code {vr.exit_code}"
            return _error(f"Verification failed: {error_detail[:300]}", parsed.cost, duration)
        print(f"  Verified: {task.verify}")

    return IterationResult(
        task_id=task.id,
        task_name=task.name,
        status="done",
        cost_usd=parsed.cost,
        duration_seconds=duration,
        output_summary=parsed.summary,
    )


@dataclass
class ClaudeOutput:
    cost: float = 0.0
    summary: str = ""
    permission_denials: list[str] = field(default_factory=list)


def _parse_claude_output(raw: str) -> ClaudeOutput:
    out = ClaudeOutput()
    try:
        data = json.loads(raw)
    except (json.JSONDecodeError, ValueError):
        out.summary = raw[:500]
        return out

    if not isinstance(data, dict):
        out.summary = raw[:500]
        return out

    # Cost
    if "total_cost_usd" in data:
        out.cost = float(data["total_cost_usd"])
    elif "cost_usd" in data:
        out.cost = float(data["cost_usd"])
    else:
        usage = data.get("usage", {})
        if isinstance(usage, dict) and "cost_usd" in usage:
            out.cost = float(usage["cost_usd"])

    # Summary
    out.summary = str(data.get("result", ""))[:500]

    # Permission denials
    denials = data.get("permission_denials", [])
    if isinstance(denials, list):
        out.permission_denials = [d.get("tool_name", "unknown") for d in denials if isinstance(d, dict)]

    return out
