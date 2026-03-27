---
name: fix
description: >
  Small targeted change harness. Research → generate → evaluate → commit.
  Stays on current branch by default. No PR unless asked.
  Use for bug fixes, typo corrections, small config changes, doc updates,
  minor refactors -- anything scoped to one area and one commit.
  Triggers on: "fix this", "patch this", "correct this", "quick change",
  "update just this one thing", "tweak".
  Use /make for new features. Use /build for multi-area or unattended work.

  Flags:
    --branch    create a new branch before working
    --worktree  create an isolated git worktree
    --pr        commit and open a PR (default: commit only)
    --no-commit leave changes unstaged, no commit
---

# Fix

Small targeted change. Three agents in sequence, no loops.

## Variables

- `argument` -- description of the change, or path to a spec file

## Instructions

### Step 0: Parse

If `argument` is a `.md` file path, read it. Extract flags from the argument string.

### Step 1: Git setup

**Default (no flag):** stay on current branch. Note the current branch name.

**`--branch`:** derive a short branch name from the description (e.g., `fix/null-check-login`).
Invoke the `/branch` skill with that name.

**`--worktree`:** derive a branch name. Run:
```
git worktree add /tmp/<branch-name> -b <branch-name>
```
Pass the worktree path to all subsequent agents as their working directory.

### Step 2: Research

Invoke the `research` agent. Pass:
- The change description or spec
- Working directory (worktree path if applicable)

The agent finds the relevant code and returns a brief: what to change, where, and why.

### Step 3: Generate

Invoke the `generator` agent. Pass:
- The change description
- The research brief
- A minimal contract: what the fix does + two or three success criteria derived from the description

The generator implements the change and verifies build/lint pass.

### Step 4: Evaluate

Invoke the `evaluator` agent. Pass:
- The success criteria from the generator's contract
- The generator's output summary

Single pass -- no retry loop. If the evaluator returns FAIL, print the specific failures and stop. Don't proceed to commit.

### Step 5: Git result

**Default:** invoke the `commit-commands:commit` skill.

**`--pr`:** invoke the `commit-commands:commit-push-pr` skill.

**`--no-commit`:** skip. Leave changes in place and report what changed.

**If `--worktree`:** after commit, clean up:
```
git worktree remove /tmp/<branch-name>
```
Unless `--pr` was used, in which case leave the worktree until the PR is open.

## Output

```
Fix: <description>
Branch: <name or current>

[research]  ✓ <one-line summary of what was found>
[generate]  ✓ <files changed>
[evaluate]  ✓ pass  (or ✗ <failing criteria>)

Committed: <hash> <message>   (or PR: <url>)
```

## Cookbook

<If: evaluator fails>
<Then: stop and report the specific failures. Don't commit partial work. The user can refine the description and re-run, or switch to /make if the scope is larger than expected.>

<If: change is purely mechanical (rename, format, delete dead code)>
<Then: research is still useful to find all affected locations. Don't skip it.>

<If: --branch and --pr are both set>
<Then: create the branch, do the work, commit and open a PR from that branch.>
