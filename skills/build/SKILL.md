---
name: build
description: >
  Complex multi-sprint harness. Planner expands the spec into sprint contracts,
  then loops generator→evaluator per sprint (up to 3 cycles each) until all
  criteria pass. Ends with security scan, simplify, and PR. Creates a branch
  by default. Use for large features, multi-area work, or anything too complex
  for a single implementation session.
  Triggers on: "build this", "use the harness", "multi-sprint", "complex feature",
  "big change", "planner generator evaluator".
  Use /fix for small targeted changes. Use /make for standard single-session features.

  Flags:
    --current   stay on current branch
    --worktree  create an isolated git worktree (best for unattended builds)
    --no-pr     commit only, skip PR
---

# Build

Complex feature harness. Planner defines sprint contracts, then generator→evaluator loop per sprint. Branches and PRs by default.

## Variables

- `argument` -- spec file path or inline description

## Instructions

### Step 0: Parse

If `argument` is a `.md` file path, read it. Otherwise treat as inline description. Extract flags.

State intent before starting:
```
Build: <spec summary>
```

### Step 1: Git setup

**Default:** derive a branch name from the spec (e.g., `feat/auth-system`).
Invoke the `/branch` skill with that name.

**`--current`:** stay on current branch.

**`--worktree`:** derive a branch name. Run:
```
git worktree add /tmp/<branch-name> -b <branch-name>
```
Pass the worktree path to all subsequent agents as their working directory. This is the best option for unattended builds -- the main checkout stays clean.

### Step 2: Plan

Invoke the `planner` agent. Pass:
- The spec (file contents or inline text)
- Working directory

The planner reads the codebase and returns: project type, stack, build commands, and numbered sprints each with scope + success criteria (the sprint contract).

Print the full plan. If it has more than 6 sprints, confirm scope with the user before continuing.

### Step 3: Sprint loop

For each sprint, run up to 3 generator→evaluator cycles:

#### 3a. Generate

Invoke the `generator` agent. Pass:
- This sprint's contract (goal, scope, success criteria)
- The full plan (context)
- Evaluator feedback from the previous cycle (if retrying)

#### 3b. Evaluate

Invoke the `evaluator` agent. Pass:
- This sprint's contract
- Generator output summary
- Note if Playwright MCP tools are available for web projects

#### 3c. Verdict

- **PASS:** print `[sprint N/total] ✓ <name>` and advance
- **FAIL:** print failing criteria and feedback, return to 3a (up to 3 cycles)
- **3 cycles exhausted:** stop the build. Report which criteria are failing. Don't continue to later sprints with a broken foundation.

#### 3d. Commit gate

After each sprint passes, verify a commit exists (check `git log --oneline -1`). If the generator didn't commit, invoke the `generator` agent again with only the task: commit this sprint's work with a conventional commit message.

### Step 4: Security

Invoke the `security` agent on the full diff. If critical issues are found:
- Invoke the `generator` agent with only those issues to fix
- Re-run the `evaluator` on the changed files
- One fix cycle only. If still critical, note in report and continue.

### Step 5: Simplify

Invoke the `/simplify` skill on all changed files.

### Step 6: Git result

**Default:** invoke the `commit-commands:commit-push-pr` skill.

**`--no-pr`:** invoke the `commit-commands:commit` skill only.

**If `--worktree`:** after PR is open:
```
git worktree remove /tmp/<branch-name>
```

## Output

```
Build: <spec name>
Branch: <name>

Plan: <N> sprints

[sprint 1/N] ✓ <name>  (1 cycle)
[sprint 2/N] ✓ <name>  (3 cycles)
...

[security]  ✓ / ⚠ <N findings>
[simplify]  ✓

PR: <url>   (or Committed: <hash>)
```

## Cookbook

<If: evaluator fails 3 cycles on a sprint>
<Then: stop. Report the failing criteria, the last round of generator output, and what the evaluator said. The sprint contract may be too large, the spec may be ambiguous, or there's a codebase blocker. Don't carry a broken sprint forward.>

<If: spec is small enough for one sprint>
<Then: planner returns a single sprint. The loop runs once. Still valuable -- the evaluator loop will refine quality even on small scope.>

<If: project is a web app with Playwright available>
<Then: tell the evaluator it can use Playwright tools to drive the running app. Pass this in every evaluator invocation.>

<If: a later sprint depends on an earlier one that failed>
<Then: stop at the failure. Later sprints that build on broken foundations will fail too -- don't run them.>

<If: evaluator notes issues outside the sprint contract>
<Then: those go in "Other observations" and don't affect the verdict. The contract is the only pass/fail gate. Accumulate them and surface in the final report.>

<If: --worktree is set and a sprint fails after 3 cycles>
<Then: clean up the worktree before exiting: git worktree remove /tmp/<branch-name>. Don't leave orphaned worktrees.>

<If: spec has vague success criteria after planning>
<Then: surface the planner's criteria to the user before generating sprint 1. Ambiguous criteria are the most common cause of evaluator loops that never converge.>
