# Feature: Long-Running Autonomous Claude Code Harness

## Metadata

type: `feat`
task_id: `long-running-harness`

## Background

This project lives inside `~/dev/claude`, a portable Claude Code config framework with 14 skills, 8 agents, and 5 hooks. The existing `pipeline` skill chains a full dev workflow (spec -> branch -> decompose -> implement -> test -> review -> commit -> PR) but runs within a single session context window.

Anthropic's autonomous coding research (Nov 2025) identified two failure modes in long-running agents: (1) one-shotting -- trying to build everything at once and running out of context, and (2) premature victory -- a later session declaring the job done prematurely. Their solution is a two-agent pattern: an initializer that generates a structured task list, and a coding agent that loops -- each iteration reading progress, picking one task, implementing it, testing, committing, and updating progress.

The Anthropic quickstart (`github.com/anthropics/claude-quickstarts/tree/main/autonomous-coding`) uses the Python Agent SDK with a `feature_list.json` (flat array, `"passes": false` per item) and `claude-progress.txt` for cross-session orientation. Each iteration gets a fresh context window. The outer loop is a simple Python `for` with auto-delays.

Claude Code's `claude -p` flag enables headless execution with JSON output, session resumption (`--resume SESSION_ID`), and configurable max turns. This is the CLI equivalent of the Agent SDK pattern.

## Feature Description

A standalone Python CLI tool (managed by `uv`) that orchestrates Claude Code in a loop to autonomously implement large features over many hours. It initializes a project with a structured JSON task list from a spec, then runs discrete `claude -p` sessions -- each making incremental progress on one task, persisting state, and continuing until all tasks are done or a stop condition is hit.

## User Story

As a developer with a comprehensive spec
I want to launch an autonomous agent loop that grinds through implementation tasks
So that large features get built over hours without constant manual intervention

## Scope

### In Scope

- CLI tool with `init` and `run` subcommands
- Initializer: generate JSON task list from a spec file or prompt
- Loop harness: run `claude -p` per iteration with crafted prompts
- Progress tracking: JSON task file + progress log + git commits
- Failure handling: retry once, then pause and notify
- Termination: all tasks done, max iterations, or max cost ceiling
- Notifications: desktop (`notify-send`) and optional webhook
- Sequential execution by default, `--parallel N` flag for concurrent tasks
- Prompt templates: bundled initializer and coding agent prompts
- Cost tracking from Claude Code JSON output

### Out of Scope

- GUI or web dashboard
- Integration with Claude Code Tasks API (may add later)
- Integration with Virgil
- Agent Teams coordination
- Visual verification (Puppeteer MCP) -- users can add this to their prompt templates
- Voice notifications
- Session resumption (each iteration is a fresh session)

## Acceptance Criteria

- [ ] `uv run claude init --spec path/to/spec.md` generates a `tasks.json` with structured task entries
- [ ] `uv run claude init --prompt "Build a REST API for..."` generates tasks from an inline description
- [ ] `uv run claude run` loops through tasks, running `claude -p` per iteration
- [ ] Each iteration: reads progress, picks next pending task, implements, tests, commits, updates progress
- [ ] `tasks.json` tracks status per task (`pending`, `in_progress`, `done`, `error`)
- [ ] `progress.md` is written after each iteration with orientation context for the next session
- [ ] Git commit after each successful iteration
- [ ] On failure: retry once, then mark task `error`, pause loop, send notification
- [ ] `--on-failure skip` continues to next task instead of pausing
- [ ] `--max-iterations N` stops after N iterations
- [ ] `--max-cost N.NN` stops when cumulative cost exceeds threshold
- [ ] `--parallel N` runs N concurrent `claude -p` processes on independent tasks
- [ ] Desktop notification via `notify-send` on pause, completion, or failure
- [ ] `--notify webhook=URL` sends POST to webhook on events
- [ ] `uv run claude status` shows current progress summary
- [ ] All state is file-based and git-trackable (no database)

## Relevant Files

- `/home/jpb/dev/claude/settings.json` -- existing Claude Code settings with hook patterns
- `/home/jpb/dev/claude/skills/pipeline/SKILL.md` -- existing pipeline skill for reference on workflow steps
- `/home/jpb/dev/claude/skills/implement/SKILL.md` -- existing implement skill for per-task execution patterns
- `/home/jpb/dev/claude/skills/decompose/SKILL.md` -- existing decompose skill for task breakdown patterns

### New Files

- `claude/pyproject.toml` -- uv project definition with dependencies and CLI entry point
- `claude/src/claude_harness/__init__.py` -- package init
- `claude/src/claude_harness/cli.py` -- CLI entry point with `init`, `run`, `status` subcommands
- `claude/src/claude_harness/init.py` -- initializer: spec -> task list generation
- `claude/src/claude_harness/runner.py` -- loop harness: iterate, invoke `claude -p`, track progress
- `claude/src/claude_harness/tasks.py` -- task list read/write/query operations on `tasks.json`
- `claude/src/claude_harness/progress.py` -- progress file read/write, cost tracking
- `claude/src/claude_harness/notify.py` -- notification dispatch (desktop + webhook)
- `claude/src/claude_harness/prompts/initializer.md` -- prompt template for task list generation
- `claude/src/claude_harness/prompts/coding.md` -- prompt template for coding iterations
- `claude/tests/` -- test directory

## Decisions

| Decision | Choice | Rationale |
| -------- | ------ | --------- |
| Implementation medium | Standalone uv Python project | Decoupled from Claude Code config repo, Python gives good subprocess/async support |
| Progress state format | JSON task file (`tasks.json`) | Proven by Anthropic research, git-diffable, model less likely to corrupt JSON than markdown |
| Loop strategy | Sequential default, `--parallel N` option | Sequential is proven and easier to debug, parallel available when needed |
| Iteration scope | Raw prompt with bundled template | Maximum flexibility, decoupled from skills repo |
| Human-in-the-loop | Desktop notifications default, webhook option | Simple to start, extensible later |
| Failure handling | Retry once then pause (configurable) | Failed iteration likely means structural issue, don't waste tokens |
| Termination conditions | All done OR max iterations OR max cost | Multiple independent stop conditions, whichever hits first |

## Implementation Plan

### Phase 1: Project Scaffolding

Set up the uv project structure, CLI entry point with subcommands, and core data models (task list schema, progress file format).

### Phase 2: Initializer

Build the `init` subcommand that takes a spec file or inline prompt, invokes `claude -p` once to generate a structured task list, and writes `tasks.json` + initial `progress.md`.

### Phase 3: Runner Loop

Build the `run` subcommand -- the core loop that reads `tasks.json`, picks the next pending task, constructs a prompt from the coding template + progress context, invokes `claude -p`, parses output, updates task status, writes progress, and commits.

### Phase 4: Failure Handling and Termination

Add retry logic, error classification, `--on-failure` flag, and the three termination conditions (all done, max iterations, max cost). Parse cost from Claude Code JSON output.

### Phase 5: Notifications

Add `notify-send` desktop notifications and `--notify webhook=URL` support. Fire on: iteration complete, failure/pause, all tasks done, cost ceiling hit.

### Phase 6: Parallel Execution

Add `--parallel N` flag that spawns N concurrent `claude -p` processes. Each claims a task atomically (file lock on `tasks.json`), runs in isolation, and updates state on completion.

### Phase 7: Status Command

Build `uv run claude status` that reads `tasks.json` and `progress.md` to display a summary: tasks done/pending/error, total cost, elapsed time.

## Step by Step Tasks

IMPORTANT: Execute every step in order, top to bottom.

### 1. Scaffold uv Project

- Run `uv init claude` to create the project at `./claude`
- Configure `pyproject.toml`: set name to `claude-harness`, add `click` dependency, define `[project.scripts]` entry point
- Create `src/claude_harness/` package structure
- Verify `uv run claude-harness --help` works

### 2. Define Task Data Model

- Create `src/claude_harness/tasks.py`
- Define `Task` dataclass: `id`, `name`, `description`, `status` (pending/in_progress/done/error), `error_message`, `attempts`, `started_at`, `completed_at`
- Define `TaskList` with `load(path)`, `save(path)`, `next_pending()`, `claim(task_id)`, `complete(task_id)`, `fail(task_id, error)`, `summary()` methods
- Use `fcntl.flock` for file locking on writes (needed for parallel mode)

### 3. Define Progress Model

- Create `src/claude_harness/progress.py`
- Define `Progress` with fields: `iteration`, `total_cost`, `last_task`, `last_status`, `started_at`, `notes`
- Methods: `load(path)`, `save(path)`, `update(iteration_result)`, `format_for_prompt()` (renders orientation context for next session)
- Track cumulative cost parsed from `claude -p --output-format json` output (`usage.cost` field or token counts)

### 4. Build CLI Entry Point

- Create `src/claude_harness/cli.py` using `click`
- Define `cli` group with subcommands: `init`, `run`, `status`
- `init` options: `--spec PATH`, `--prompt TEXT`, `--project-dir PATH` (default `.`), `--model TEXT`
- `run` options: `--project-dir PATH`, `--max-iterations INT`, `--max-cost FLOAT`, `--on-failure [pause|skip]`, `--parallel INT` (default 1), `--notify [desktop|webhook=URL]`, `--model TEXT`
- `status` options: `--project-dir PATH`

### 5. Build Initializer

- Create `src/claude_harness/init.py`
- Read spec file or accept inline prompt
- Construct initializer prompt from `prompts/initializer.md` template: instructs Claude to read the spec and produce a JSON task list
- Invoke `claude -p --output-format json --max-turns 3` with the prompt
- Parse the response, extract JSON task list from Claude's output
- Write `tasks.json` and initial `progress.md`
- Git commit: `chore: initialize task list from spec`

### 6. Write Prompt Templates

- Create `src/claude_harness/prompts/initializer.md`: instructions for generating a task list from a spec, output format requirements, ordering guidance
- Create `src/claude_harness/prompts/coding.md`: the 10-step coding agent prompt adapted from Anthropic's pattern -- orient, pick task, implement, test, commit, update progress. Include strong guardrails: "Do not remove or modify existing tests", "Do not mark a task done unless tests pass", "Make one focused commit per task"

### 7. Build Runner Loop

- Create `src/claude_harness/runner.py`
- `run_iteration(project_dir, task, progress, model)`:
  - Construct prompt from coding template + progress context + task description
  - Invoke `claude -p --output-format json --allowedTools Bash,Read,Write,Edit,Glob,Grep` in `project_dir`
  - Parse JSON output for result, cost/usage, session_id
  - Return `IterationResult` with status, cost, output summary
- `run_loop(config)`:
  - Load tasks and progress
  - Loop: check termination conditions -> pick next task -> run_iteration -> update state -> commit -> notify
  - Handle KeyboardInterrupt gracefully (save state, report progress)

### 8. Add Failure Handling

- In `run_iteration`: catch subprocess errors, timeouts, non-zero exit codes
- On failure: retry once with additional context ("Previous attempt failed: {error}")
- If retry fails: mark task `error`, based on `--on-failure`:
  - `pause` (default): stop loop, send notification
  - `skip`: move to next pending task
- Write failure details to `progress.md` for debugging

### 9. Add Cost Tracking and Termination

- Parse cost from `claude -p --output-format json` output (look for `usage` field with `input_tokens`, `output_tokens`, or `cost_usd`)
- Accumulate in `Progress.total_cost`
- Check three stop conditions before each iteration:
  - `tasks.all_done()` -- no more pending tasks
  - `progress.iteration >= max_iterations` (if set)
  - `progress.total_cost >= max_cost` (if set)
- On any stop: save state, send notification with reason

### 10. Add Notifications

- Create `src/claude_harness/notify.py`
- `notify_desktop(title, message)`: invoke `notify-send` via subprocess
- `notify_webhook(url, event_data)`: POST JSON to URL via `urllib.request`
- Events: `iteration_complete`, `task_failed`, `loop_paused`, `loop_complete`, `cost_ceiling`
- `Notifier` class that dispatches to configured channels

### 11. Add Parallel Execution

- In `run_loop`: when `parallel > 1`, use `asyncio` or `concurrent.futures.ProcessPoolExecutor`
- Each worker: atomically claim a task (file lock), run iteration, update state
- Workers share `tasks.json` via file locking (`fcntl.flock`)
- Collect results, update progress after each worker completes
- Stop all workers when any termination condition is hit

### 12. Build Status Command

- In `cli.py` `status` subcommand: load `tasks.json` and `progress.md`
- Display: total tasks, pending/in_progress/done/error counts, total cost, elapsed time, last completed task, current iteration number
- Compact table format for terminal output

### 13. Write Tests

- Create `tests/test_tasks.py`: task list CRUD, file locking, state transitions
- Create `tests/test_progress.py`: progress tracking, cost accumulation, format_for_prompt
- Create `tests/test_runner.py`: mock `claude -p` subprocess, verify prompt construction, result parsing
- Create `tests/test_notify.py`: mock notify-send and webhook calls
- Use `pytest` as test runner

## Testing Strategy

### Unit Tests

- `test_tasks.py`: load/save round-trip, `next_pending` ordering, `claim`/`complete`/`fail` state transitions, concurrent file locking
- `test_progress.py`: cost accumulation, iteration counting, `format_for_prompt` output
- `test_runner.py`: prompt template rendering, `claude -p` subprocess mock, JSON output parsing, retry logic
- `test_notify.py`: desktop notification command construction, webhook POST payload

### Edge Cases

- Empty task list (all done on first check)
- All tasks already completed (resume after previous full run)
- `claude -p` returns non-JSON output (parse error handling)
- Cost field missing from output (graceful degradation)
- File lock contention in parallel mode
- KeyboardInterrupt mid-iteration (state consistency)
- Spec file not found, malformed spec
- Network failure on webhook notification (non-blocking)

## Risks & Mitigations

| Risk | Impact | Mitigation |
| ---- | ------ | ---------- |
| `claude -p` output format changes | Breaks JSON parsing | Pin to known output fields, add fallback parsing |
| Runaway cost in parallel mode | Unexpected bill | Cost ceiling checked per-worker, not just per-loop |
| Task file corruption from concurrent writes | Lost progress | File locking with `fcntl.flock`, atomic write via temp file + rename |
| Claude marks task done but tests fail | False progress | Coding prompt explicitly requires test verification before marking done |
| Context window too small for complex task | Incomplete implementation | Encourage small, focused tasks in initializer prompt |

## Validation Commands

```bash
cd claude && uv run pytest
cd claude && uv run claude-harness --help
cd claude && uv run claude-harness init --help
cd claude && uv run claude-harness run --help
cd claude && uv run claude-harness status --help
```

## Assumptions

None -- all decisions were made during the exploration phase.
