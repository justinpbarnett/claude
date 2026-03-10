from __future__ import annotations

import os
import subprocess
import sys
from pathlib import Path

import click

from harness.notify import Notifier
from harness.progress import Progress
from harness.tasks import TaskList


@click.group()
def cli():
    """Long-running autonomous Claude Code process harness."""


@cli.command()
@click.option(
    "--spec", type=click.Path(exists=True, path_type=Path), help="Path to spec file"
)
@click.option("--prompt", type=str, help="Inline description of what to build")
@click.option(
    "--project-dir",
    type=click.Path(path_type=Path),
    default=".",
    help="Target project directory",
)
@click.option("--model", type=str, help="Claude model to use")
def init(spec: Path | None, prompt: str | None, project_dir: Path, model: str | None):
    """Generate a task list from a spec file or prompt."""
    if not spec and not prompt:
        raise click.UsageError("Either --spec or --prompt is required")

    project_dir = project_dir.resolve()

    from harness.init import initialize

    try:
        task_list = initialize(project_dir, spec=spec, prompt=prompt, model=model)
    except RuntimeError as e:
        raise click.ClickException(str(e))
    summary = task_list.summary()
    click.echo(f"Initialized {summary['total']} tasks in {project_dir / 'tasks.json'}")


@cli.command()
@click.option(
    "--project-dir",
    type=click.Path(path_type=Path),
    default=".",
    help="Target project directory",
)
@click.option("--max-iterations", type=int, help="Stop after N iterations")
@click.option(
    "--max-cost", type=float, help="Stop when cumulative cost exceeds this (USD)"
)
@click.option(
    "--on-failure",
    type=click.Choice(["pause", "skip"]),
    default="pause",
    help="What to do when a task fails after retry",
)
@click.option(
    "--parallel", type=int, default=1, help="Number of concurrent claude processes"
)
@click.option(
    "--notify",
    "notify_type",
    type=str,
    default="desktop",
    help="Notification type: desktop or webhook=URL",
)
@click.option("--model", type=str, help="Claude model to use")
def run(
    project_dir: Path,
    max_iterations: int | None,
    max_cost: float | None,
    on_failure: str,
    parallel: int,
    notify_type: str,
    model: str | None,
):
    """Run the autonomous coding loop."""
    project_dir = project_dir.resolve()

    notifier = _parse_notifier(notify_type)

    from harness.runner import RunConfig, run_loop

    config = RunConfig(
        project_dir=project_dir,
        max_iterations=max_iterations,
        max_cost=max_cost,
        on_failure=on_failure,
        parallel=parallel,
        model=model,
        notifier=notifier,
    )
    run_loop(config)


@cli.command()
@click.option(
    "--spec", type=click.Path(exists=True, path_type=Path), help="Path to spec file"
)
@click.option("--prompt", type=str, help="Inline description of what to build")
@click.option(
    "--project-dir",
    type=click.Path(path_type=Path),
    default=".",
    help="Target project directory",
)
@click.option("--max-iterations", type=int, help="Stop after N iterations")
@click.option(
    "--max-cost", type=float, help="Stop when cumulative cost exceeds this (USD)"
)
@click.option(
    "--on-failure",
    type=click.Choice(["pause", "skip"]),
    default="pause",
    help="What to do when a task fails after retry",
)
@click.option(
    "--parallel", type=int, default=1, help="Number of concurrent claude processes"
)
@click.option(
    "--notify",
    "notify_type",
    type=str,
    default="desktop",
    help="Notification type: desktop or webhook=URL",
)
@click.option("--model", type=str, help="Claude model to use")
@click.option(
    "--foreground", is_flag=True, help="Run in foreground instead of background"
)
def start(
    spec: Path | None,
    prompt: str | None,
    project_dir: Path,
    max_iterations: int | None,
    max_cost: float | None,
    on_failure: str,
    parallel: int,
    notify_type: str,
    model: str | None,
    foreground: bool,
):
    """Initialize tasks from a spec and run the loop (backgrounds by default)."""
    if not spec and not prompt:
        raise click.UsageError("Either --spec or --prompt is required")

    project_dir = project_dir.resolve()
    log_file = project_dir / "harness.log"

    if not foreground:
        # Re-invoke ourselves with --foreground in a backgrounded subprocess
        # Use uv run from the harness project dir so the package is on the path
        harness_dir = Path(__file__).resolve().parent.parent.parent
        cmd = ["uv", "run", "harness", "start", "--foreground"]
        if spec:
            cmd.extend(["--spec", str(spec)])
        if prompt:
            cmd.extend(["--prompt", prompt])
        cmd.extend(["--project-dir", str(project_dir)])
        if max_iterations:
            cmd.extend(["--max-iterations", str(max_iterations)])
        if max_cost:
            cmd.extend(["--max-cost", str(max_cost)])
        cmd.extend(["--on-failure", on_failure])
        cmd.extend(["--parallel", str(parallel)])
        cmd.extend(["--notify", notify_type])
        if model:
            cmd.extend(["--model", model])

        with open(log_file, "w") as lf:
            proc = subprocess.Popen(
                cmd,
                cwd=harness_dir,
                stdout=lf,
                stderr=subprocess.STDOUT,
                start_new_session=True,
                env=os.environ.copy(),
            )

        # Save PID for status command
        pid_file = project_dir / "harness.pid"
        pid_file.write_text(str(proc.pid))

        click.echo(f"Harness started in background (PID {proc.pid})")
        click.echo(f"Log: {log_file}")
        click.echo(f"Check progress: harness status --project-dir {project_dir}")
        return

    # Foreground mode: init then run
    click.echo("Initializing tasks...")
    from harness.init import initialize

    try:
        task_list = initialize(project_dir, spec=spec, prompt=prompt, model=model)
    except RuntimeError as e:
        raise click.ClickException(str(e))

    summary = task_list.summary()
    click.echo(f"Initialized {summary['total']} tasks. Starting run loop...")

    notifier = _parse_notifier(notify_type)

    from harness.runner import RunConfig, run_loop

    config = RunConfig(
        project_dir=project_dir,
        max_iterations=max_iterations,
        max_cost=max_cost,
        on_failure=on_failure,
        parallel=parallel,
        model=model,
        notifier=notifier,
    )
    run_loop(config)


@cli.command()
@click.option(
    "--project-dir",
    type=click.Path(path_type=Path),
    default=".",
    help="Target project directory",
)
@click.option(
    "--logs", type=int, default=0, help="Show last N lines of the log file"
)
def status(project_dir: Path, logs: int):
    """Show current progress summary."""
    project_dir = project_dir.resolve()
    tasks_path = project_dir / "tasks.json"
    progress_path = project_dir / "progress.json"
    pid_file = project_dir / "harness.pid"

    # Process status
    if pid_file.exists():
        pid = int(pid_file.read_text().strip())
        if _is_running(pid):
            click.echo(f"Status: RUNNING (PID {pid})")
        else:
            click.echo("Status: STOPPED")
            pid_file.unlink(missing_ok=True)
    else:
        click.echo("Status: NOT STARTED")

    if not tasks_path.exists():
        click.echo("No tasks.json found. Run 'harness start' first.")
        return

    task_list = TaskList.load(tasks_path)
    summary = task_list.summary()

    click.echo(f"\nTasks: {summary['total']} total")
    click.echo(f"  Pending:     {summary['pending']}")
    click.echo(f"  In Progress: {summary['in_progress']}")
    click.echo(f"  Done:        {summary['done']}")
    click.echo(f"  Error:       {summary['error']}")

    if progress_path.exists():
        progress = Progress.load(progress_path)
        click.echo(f"\nIterations: {progress.iteration}")
        click.echo(f"Total cost: ${progress.total_cost:.4f}")
        if progress.started_at:
            click.echo(f"Started:    {progress.started_at}")
        if progress.last_task:
            click.echo(f"Last task:  {progress.last_task} ({progress.last_status})")

    # Show tasks with errors
    errors = [t for t in task_list.tasks if t.status == "error"]
    if errors:
        click.echo("\nFailed tasks:")
        for t in errors:
            click.echo(f"  [{t.id}] {t.name}: {t.error_message}")

    # Show log tail
    log_file = project_dir / "harness.log"
    if logs > 0 and log_file.exists():
        lines = log_file.read_text().splitlines()
        tail = lines[-logs:]
        click.echo(f"\n--- Last {len(tail)} log lines ---")
        for line in tail:
            click.echo(line)


def _is_running(pid: int) -> bool:
    try:
        os.kill(pid, 0)
        return True
    except (OSError, ProcessLookupError):
        return False


def _parse_notifier(notify_type: str) -> Notifier:
    if notify_type.startswith("webhook="):
        url = notify_type[len("webhook=") :]
        return Notifier(desktop=False, webhook_url=url)
    elif notify_type == "desktop":
        return Notifier(desktop=True)
    elif notify_type == "none":
        return Notifier(desktop=False)
    else:
        return Notifier(desktop=True)
