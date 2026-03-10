# Feature: Agent Teams Integration

## Metadata

type: `feat`
task_id: `agent-teams`

## Background

The Claude Code configuration repo at `~/dev/claude` has 14 skills, 8 agents, and 6 hook scripts that form a structured development workflow. The pipeline skill already orchestrates parallel subagents via the Agent tool (Step 4, lines 92-100), launching one general-purpose agent per decomposed stage. The decompose skill produces a staged JSON task graph with dependency ordering. Five of the 14 skills delegate to named agents (research, security, test-gen, deps, api-docs).

Agent Teams is an experimental Claude Code feature (enabled via `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1` in settings.json `env`) that formalizes multi-agent coordination: a lead agent spawns teammates, each with their own context window, coordinated through a shared task list with direct inter-teammate messaging. This differs from subagents, which report results back to a single caller without peer communication.

The settings schema supports team-specific hook events: `TeammateIdle`, `TaskCompleted`, `SubagentStart`, and `SubagentStop`. The existing hook scripts follow a consistent pattern: read JSON from stdin, extract relevant fields via `jq`, perform the action, and exit 0 (or output `hookSpecificOutput` JSON to feed context back to the model).

## Feature Description

Integrate Agent Teams into the existing skill and hook ecosystem so that complex, parallelizable work automatically uses coordinated teammate agents instead of independent subagents, while simple tasks continue using the lightweight subagent path.

## User Story

As a developer using this Claude Code configuration
I want skills to automatically leverage agent teams for complex parallel work
So that multi-file features get coordinated implementation with shared context instead of isolated subagent execution

## Scope

### In Scope

- New `/team` skill for on-demand team spawning
- Update 5 existing skills (pipeline, implement, decompose, review, test) with agent-team-aware Cookbook entries
- Add 2 new hook scripts (`TeammateIdle` lint hook, `TaskCompleted` logging hook)
- Update `settings.json` with new hook registrations
- Update decompose output schema with optional `teammate_assignments` field

### Out of Scope

- Updating the remaining 9 skills (spec, commit, pr, branch, start, setup, document, prime, skill-builder) -- these are inherently single-threaded or conversational
- Creating new agents -- existing agents (research, security, test-gen) are sufficient
- Worktree-per-teammate isolation -- rely on decompose's stage model instead
- Nested teams (teams spawning sub-teams)
- Session resumption for teammates (known platform limitation)

## Acceptance Criteria

- [ ] New `/team` skill exists at `skills/team/SKILL.md` and can spawn a team from a task description or spec file
- [ ] `/team` skill defaults teammates to sonnet model, lead stays on session model (opus)
- [ ] Pipeline Step 4 uses agent teams (not subagents) when decompose produces 2+ stages
- [ ] Pipeline Step 4 falls back to single subagent when decompose produces 1 stage or `is_decomposed: false`
- [ ] Implement skill has Cookbook entry for spawning teammates when task touches 3+ independent files/modules
- [ ] Decompose output schema supports optional `teammate_assignments` mapping tasks to recommended teammate roles
- [ ] Review skill has Cookbook entry for parallel review + security + test teammates
- [ ] Test skill has Cookbook entry for parallel test execution across multiple app types
- [ ] `TeammateIdle` hook runs lint on changed files in the teammate's scope
- [ ] `TaskCompleted` hook logs completed tasks to project memory
- [ ] `settings.json` registers both new hooks
- [ ] All existing hooks continue to work unchanged

## Relevant Files

- `skills/pipeline/SKILL.md` -- Master orchestrator; Step 4 parallel subagent pattern needs team upgrade
- `skills/implement/SKILL.md` -- Single-task executor; add team-aware Cookbook entry
- `skills/decompose/SKILL.md` -- Task graph producer; add `teammate_assignments` to output schema
- `skills/review/SKILL.md` -- Review skill; add parallel review team Cookbook entry
- `skills/test/SKILL.md` -- Test skill; add parallel test team Cookbook entry
- `settings.json` -- Global config; add new hook registrations
- `~/.claude/hooks/track-commits.sh` -- Reference pattern for the TaskCompleted logging hook
- `~/.claude/hooks/post-edit-lint.sh` -- Reference pattern for the TeammateIdle lint hook

### New Files

- `skills/team/SKILL.md` -- New skill for on-demand agent team spawning and management
- `~/.claude/hooks/teammate-idle-lint.sh` -- TeammateIdle hook that lints changed files
- `~/.claude/hooks/track-tasks.sh` -- TaskCompleted hook that logs to project memory

## Decisions

| Decision | Choice | Rationale |
| -------- | ------ | --------- |
| `/team` skill scope | Spawn + lightweight management (status, cleanup) | Full team management (reassign, message) is better handled via natural language to the lead |
| Skill upgrade strategy | Optional Cookbook entries triggered by complexity | Avoids forking skill logic; runtime decision based on task shape |
| Pipeline team threshold | 2+ stages from decompose | Single-stage work doesn't benefit from team overhead (4-15x token cost) |
| Hook events to use | `TeammateIdle` + `TaskCompleted` only | `SubagentStart`/`SubagentStop` are noisy; these two provide the most value |
| Teammate model | Sonnet (teammates), Opus (lead) | Teammates do focused scoped work; matches existing agent pattern (all agents use sonnet/haiku) |
| File conflict prevention | Decompose stage model + file ownership in prompts | Stage ordering prevents cross-stage conflicts; same-stage tasks should own different files |

## Implementation Plan

### Phase 1: New `/team` skill

Create the team skill that spawns and manages agent teams on demand. This is independent of all other changes.

### Phase 2: Hook scripts

Create the two new hook scripts and register them in settings.json. Independent of skill changes.

### Phase 3: Skill updates

Update the 5 existing skills with agent-team-aware Cookbook entries. Depends on understanding the `/team` skill's interface (Phase 1) but the changes are Cookbook additions, not structural rewrites.

## Step by Step Tasks

IMPORTANT: Execute every step in order, top to bottom.

### 1. Create `/team` skill

Create `skills/team/SKILL.md` following the established skill structure (YAML frontmatter, Purpose, Variables, Instructions, Workflow, Cookbook, Validation, Examples).

The skill should:

- Accept a task description, spec file path, or decomposed task graph JSON
- Analyze the input to determine optimal team composition (number of teammates, roles)
- Default to 3-5 teammates unless the task clearly needs fewer or more
- Assign each teammate a clear role, scope, and file ownership list
- Set teammate model to sonnet via natural language instruction to the lead
- Provide status reporting (which teammates are active, what they're working on)
- Handle cleanup when the team finishes
- Include negative triggers: do NOT use for simple single-file changes, do NOT use for conversational tasks (use spec), do NOT use for committing/PRs

Key Cookbook entries:
- `<If: input is a spec file> <Then: read the spec, identify parallel work streams, spawn teammates per stream>`
- `<If: input is a decomposed task graph> <Then: map each stage to a round of teammates, wait between stages>`
- `<If: task involves fewer than 3 independent concerns> <Then: suggest using a regular subagent instead, as teams add token overhead>`
- `<If: two teammates need the same file> <Then: assign the file to one teammate and have the other wait or work on a different aspect>`
- `<If: a teammate fails or gets stuck> <Then: reassign its work to another teammate or handle in the lead context>`

### 2. Create `teammate-idle-lint.sh` hook

Create `~/.claude/hooks/teammate-idle-lint.sh` following the pattern from `post-edit-lint.sh`:

- Read JSON from stdin
- Extract the teammate's working directory and changed files from the hook input
- Run the appropriate linter (go vet, ruff, eslint) on changed files
- Output `hookSpecificOutput` JSON if lint issues are found
- Exit 0 on success or no-op

### 3. Create `track-tasks.sh` hook

Create `~/.claude/hooks/track-tasks.sh` following the pattern from `track-commits.sh`:

- Read JSON from stdin
- Extract task ID, title, and status from the hook input
- Append a one-line entry to `~/.claude/projects/{project-path}/memory/recent-tasks.md`
- Keep only the last 30 entries (more than commits since tasks are finer-grained)
- Exit 0

### 4. Register new hooks in `settings.json`

Add to the `hooks` object in `settings.json`:

- `TeammateIdle` array with `teammate-idle-lint.sh` (timeout: 30, statusMessage: "Linting teammate changes...")
- `TaskCompleted` array with `track-tasks.sh` (timeout: 10, statusMessage: "Tracking task completion...")

### 5. Update pipeline skill (Step 4)

Modify `skills/pipeline/SKILL.md` Step 4 "Implement" section:

- When decompose returns `is_decomposed: true` with 2+ stages, instruct the lead to create an agent team instead of launching individual subagents
- Each stage becomes a round: spawn teammates for all tasks in the stage, wait for completion, then spawn the next round
- Teammates use sonnet model
- Each teammate gets its mini-spec file path and explicit file ownership
- After all stages, run integration compile check (unchanged)
- When `is_decomposed: false` or single stage, keep existing single subagent behavior (unchanged)

Add Cookbook entry:
- `<If: decomposed task graph has 2+ stages> <Then: use agent teams for parallel implementation. Spawn teammates per stage, each running /implement on their mini-spec. Teammates use sonnet. Wait for each stage to complete before starting the next.>`
- `<If: decomposed task graph has 1 stage or is_decomposed is false> <Then: use a single subagent as before. Teams add overhead without benefit for single-stage work.>`

### 6. Update implement skill

Add Cookbook entry to `skills/implement/SKILL.md`:

- `<If: task touches 3+ independent files/modules that can be worked on in parallel> <Then: consider spawning teammates to parallelize the work. Assign each teammate a subset of files with clear ownership. Use sonnet for teammates.>`

### 7. Update decompose skill

Modify `skills/decompose/SKILL.md`:

- Add optional `teammate_assignments` field to the task graph JSON output schema
- Each task in the graph can include a `files_owned` array listing files that task exclusively modifies
- Add a validation rule: no two tasks in the same stage should have overlapping `files_owned` entries

Updated JSON schema example:
```json
{
  "parent_spec": "{spec_file_path}",
  "task_id": "{task_id}",
  "is_decomposed": true,
  "tasks": [
    {
      "id": "task-1-data-model",
      "title": "Add data model and migration",
      "stage": 1,
      "spec_file": "specs/subtasks/{task_id}/task-1-data-model.md",
      "depends_on": [],
      "files_owned": ["src/models/user.go", "migrations/001_add_users.sql"],
      "status": "pending"
    }
  ]
}
```

### 8. Update review skill

Add Cookbook entry to `skills/review/SKILL.md`:

- `<If: diff is large (20+ files changed) and touches multiple subsystems> <Then: consider spawning a review team with parallel teammates: one for code review against the spec, one running the security agent, one running /test. Merge findings into a single report. Teammates use sonnet.>`

### 9. Update test skill

Add Cookbook entry to `skills/test/SKILL.md`:

- `<If: multiple app types detected (e.g., CLI + API + Web) and changes span all types> <Then: consider spawning teammates to test each app type in parallel. One teammate per app type, each following the appropriate test strategy. Merge results into a single JSON array. Teammates use sonnet.>`

## Testing Strategy

### Manual Validation

Since these are skill definitions (markdown) and shell scripts, testing is manual:

1. Spawn a new Claude Code session and run `/team "research the codebase from 3 angles"` to verify the team skill works
2. Run `/pipeline` on a multi-stage spec to verify teams are used instead of subagents
3. Trigger `TeammateIdle` by having a teammate finish work, verify lint runs
4. Trigger `TaskCompleted` by completing a task, verify `recent-tasks.md` is updated
5. Run `/decompose` on a spec and verify `files_owned` appears in the output

### Edge Cases

- Single-stage decomposition should NOT trigger team creation in pipeline
- Task with fewer than 3 files should NOT trigger team creation in implement
- Small diff should NOT trigger team creation in review
- Single app type should NOT trigger team creation in test
- Hook scripts should exit 0 gracefully when input JSON is missing expected fields

## Risks & Mitigations

| Risk | Impact | Mitigation |
| ---- | ------ | ---------- |
| Token cost explosion from unnecessary team spawning | High cost for simple tasks | Complexity thresholds in Cookbook entries (2+ stages, 3+ files, 20+ file diff) prevent teams on small tasks |
| File conflicts between same-stage teammates | Corrupted code from concurrent edits | `files_owned` in decompose output + validation that same-stage tasks don't overlap |
| Agent Teams feature is experimental and may change | Skill breakage on API changes | Teams are Cookbook-gated (optional behavior), not core logic. Easy to remove or update entries. |
| TeammateIdle hook input format is undocumented | Hook may not receive expected JSON fields | Defensive scripting (exit 0 on missing fields), same pattern as existing hooks |
| Teammates may not inherit session hooks | Formatting/linting gaps in teammate output | TeammateIdle hook covers the gap; existing PostToolUse hooks should still fire per-teammate |

## Validation Commands

Run these commands to verify the implementation is complete.

- Verify all new files exist: `ls skills/team/SKILL.md ~/.claude/hooks/teammate-idle-lint.sh ~/.claude/hooks/track-tasks.sh`
- Verify hook scripts are executable: `test -x ~/.claude/hooks/teammate-idle-lint.sh && test -x ~/.claude/hooks/track-tasks.sh && echo "OK"`
- Verify settings.json is valid JSON: `python3 -c "import json; json.load(open('settings.json'))"`
- Verify skill structure: grep for required sections in each modified skill (Purpose, Variables, Instructions, Workflow, Cookbook, Validation)

## Assumptions

None -- all decisions were resolved during exploration.
