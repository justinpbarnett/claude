---
name: team
description: >
  Spawns and coordinates an agent team for complex parallel work. Accepts a
  task description, spec file path, or decomposed task graph and determines
  the optimal team composition, assigns roles with file ownership, and
  monitors execution. Use when a user wants to "create a team", "spawn a
  team", "use agent teams", "team this", "swarm this", "parallelize this
  work", "split this across agents". Also triggers on "spin up teammates",
  "launch a team for this". Do NOT use for simple single-file changes (just
  edit directly). Do NOT use for committing or PRs (use the commit or pr
  skill). Do NOT use for conversational planning (use the spec skill).
  Do NOT use for sequential single-agent work (use the implement skill).
---

# Purpose

Spawns a coordinated agent team for complex tasks that benefit from parallel execution. Analyzes the input to determine team size, assigns each teammate a clear role with file ownership, and monitors the team through completion.

## Variables

- `argument` -- Task description (e.g., `"refactor auth and payments modules in parallel"`), spec file path (e.g., `specs/feat-user-auth.md`), or decomposed task graph JSON from the `/decompose` skill.

## Instructions

### Step 1: Parse Input

Determine the input type:

1. **Spec file path** -- If the argument ends with `.md` and contains a path separator, read the spec file. Extract scope, phases, and file lists.
2. **Task graph JSON** -- If the argument is valid JSON with `is_decomposed` and `tasks` fields, use the pre-decomposed task graph directly.
3. **Inline task description** -- Otherwise, treat as a natural language task. Analyze it to identify independent work streams.

### Step 2: Assess Team Viability

Before spawning a team, verify the task warrants one:

1. **Identify independent work streams** -- Count distinct files, modules, or concerns that can be worked on in parallel.
2. **Check the threshold** -- A team is warranted when there are 3+ independent work streams. Below that, a single agent or subagent is more cost-effective.
3. **Estimate team size** -- Default to 3-5 teammates. Use fewer for focused tasks, more (up to 6) for broad cross-cutting work. Never exceed 6 teammates.

If the task doesn't meet the threshold, inform the user and suggest using `/implement` or a subagent instead. Do not force a team on simple work.

### Step 3: Design Team Composition

For each teammate, define:

1. **Role** -- A short descriptive name (e.g., "auth-service", "data-model", "frontend-components", "test-writer")
2. **Scope** -- What this teammate is responsible for implementing, reviewing, or testing
3. **Files owned** -- Explicit list of files this teammate will create or modify. No two teammates in the same round should own the same file.
4. **Model** -- Default to sonnet for all teammates. The lead (you) stays on the session model.

Present the team plan to the user before spawning:

```
Team Plan: <task summary>
Teammates: <count>

1. <role> (sonnet) -- <scope summary>
   Files: <file list>
2. <role> (sonnet) -- <scope summary>
   Files: <file list>
...

Spawning team now.
```

### Step 4: Spawn and Monitor

Create the agent team with the designed composition:

1. **Spawn all teammates** with clear, detailed prompts that include:
   - Their specific role and scope
   - The files they own (and explicit instruction not to modify other files)
   - Relevant context from the spec or task description
   - The model to use (sonnet)
2. **Assign tasks** through the shared task list
3. **Monitor progress** -- Track which teammates are active and what they're working on
4. **Handle failures** -- If a teammate gets stuck or fails:
   - Attempt to reassign the work to another teammate
   - If reassignment isn't possible, handle the remaining work in the lead context
   - Log the failure for the final report

### Step 5: Integration and Cleanup

After all teammates complete their work:

1. **Run a compile/build check** on the full project to catch integration issues
2. **Fix any integration errors** (missing imports, type mismatches, conflicting changes)
3. **Clean up the team** -- Ensure all teammates are stopped
4. **Report results**:

```
Team Complete: <task summary>

Teammates: <count completed>/<count spawned>
  1. <role> -- <status> (<files changed>)
  2. <role> -- <status> (<files changed>)

Integration: <pass/fail + details>
```

## Workflow

1. **Parse** -- Determine input type (spec, task graph, or inline)
2. **Assess** -- Verify 3+ independent work streams exist
3. **Design** -- Assign roles, scopes, and file ownership
4. **Present** -- Show team plan to user
5. **Spawn** -- Create teammates with detailed prompts
6. **Monitor** -- Track progress, handle failures
7. **Integrate** -- Build check, fix conflicts
8. **Report** -- Summarize results

## Cookbook

<If: input is a spec file>
<Then: read the spec, identify parallel work streams from the implementation plan phases. Each phase or independent concern becomes a teammate assignment. If the spec has a "Relevant Files" section, use it to assign file ownership.>

<If: input is a decomposed task graph from /decompose>
<Then: map each stage to a round of teammates. Stage 1 tasks spawn first, wait for completion, then stage 2, etc. Use the files_owned field from each task for file ownership. Each task's spec_file becomes the teammate's implementation instruction.>

<If: task involves fewer than 3 independent concerns>
<Then: do not spawn a team. Inform the user: "This task has fewer than 3 independent work streams. A single agent would be more cost-effective. Consider using /implement instead." Only proceed with a team if the user insists.>

<If: two teammates need the same file>
<Then: assign the file to one teammate and have the other work on a different aspect or wait. If unavoidable, stage them sequentially (round 1 and round 2) so the second teammate sees the first's changes.>

<If: a teammate fails or gets stuck>
<Then: first check if the work can be reassigned to an idle teammate. If not, pull the remaining work into the lead context and handle it directly. Log the failure and reason in the final report.>

<If: user provides a team size preference>
<Then: respect it, but warn if the requested size seems too large (over 6) or too small (under 2) for the task. Over 6 teammates increases coordination overhead without proportional benefit.>

<If: the task is research-oriented rather than implementation>
<Then: spawn teammates with read-only scopes. Each teammate investigates a different angle or subsystem and reports findings. The lead synthesizes the results.>

<If: integration check fails after team completion>
<Then: identify which teammate's changes conflict. Fix the integration issues in the lead context. Do not re-spawn teammates for small fixes.>

## Validation

Before reporting completion, verify:

- All teammates have completed or been properly shut down
- No orphaned teammate processes remain
- Integration build check passes
- No two teammates modified the same file (unless staged in separate rounds)
- The final report includes status for every teammate
- File ownership was respected throughout execution

## Examples

### Example 1: Team from Spec File

**User says:** "Team this specs/feat-user-auth.md"

**Actions:**

1. Read spec, identify 4 concerns: data model, auth service, middleware, routes
2. Assess: 4 independent streams -- team is warranted
3. Design team:
   - Teammate 1: "data-model" -- user schema + migration (`src/models/user.go`, `migrations/001_users.sql`)
   - Teammate 2: "auth-service" -- JWT logic + token management (`src/services/auth.go`)
   - Teammate 3: "middleware" -- session middleware (`src/middleware/auth.go`)
   - Teammate 4: "routes" -- login/signup endpoints (`src/routes/auth.go`)
4. Spawn in rounds: teammates 1 first (stage 1), then 2+3 (stage 2), then 4 (stage 3)
5. Integration check: verify all imports resolve, types match
6. Report: 4/4 completed, integration passed

### Example 2: Team from Task Description

**User says:** "Spawn a team to refactor logging across all 3 services"

**Actions:**

1. Parse inline task, identify 3 services as independent streams
2. Assess: 3 streams -- team is warranted
3. Design team:
   - Teammate 1: "api-logging" -- refactor API service logging (`src/api/logger.go`)
   - Teammate 2: "worker-logging" -- refactor worker logging (`src/worker/logger.go`)
   - Teammate 3: "scheduler-logging" -- refactor scheduler logging (`src/scheduler/logger.go`)
4. Spawn all 3 in parallel (single round, no dependencies)
5. Integration check: verify consistent logging interface
6. Report: 3/3 completed, integration passed

### Example 3: Task Below Threshold

**User says:** "Team this -- add a health endpoint"

**Actions:**

1. Analyze: single endpoint, one file, one concern
2. Assess: fewer than 3 independent streams
3. Respond: "This task has fewer than 3 independent work streams. A single agent would be more cost-effective. Consider using `/implement` instead."
