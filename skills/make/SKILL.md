---
name: make
description: >
  Standard feature harness. Research → generate → evaluate → security → simplify
  → commit → PR. Creates a branch and opens a PR by default.
  Use for new features, moderate changes, anything that warrants its own PR.
  Triggers on: "make", "add", "implement this feature", "create a new",
  "build this feature", "add support for".
  Use /fix for small targeted changes. Use /build for complex multi-sprint work.

  Flags:
    --current   stay on current branch (no new branch created)
    --worktree  create an isolated git worktree
    --no-pr     commit only, skip PR
---

# Make

Standard feature harness. Five agents in sequence, single sprint, branches and PRs by default.

## Variables

- `argument` -- spec file path or inline feature description

## Instructions

### Step 0: Parse

If `argument` is a `.md` file path, read it. Otherwise treat as inline description. Extract flags.

State intent before starting:
```
Make: <feature summary>
```

### Step 1: Git setup

**Default:** derive a branch name from the spec (e.g., `feat/dark-mode-toggle`).
Invoke the `/branch` skill with that name.

**`--current`:** stay on current branch.

**`--worktree`:** derive a branch name. Run:
```
git worktree add /tmp/<branch-name> -b <branch-name>
```
Pass the worktree path to all subsequent agents as their working directory.

### Step 2: Research

Invoke the `research` agent. Pass:
- The spec or feature description
- Working directory

Returns a brief: relevant files, patterns, conventions, and anything the generator needs to match the project's style.

### Step 3: Generate

Invoke the `generator` agent. Pass:
- The full spec
- Research brief
- A sprint contract: scope = everything in the spec, success criteria derived from the spec's requirements

Single sprint -- no decomposition. If the spec is too large for one sprint, stop and suggest using `/build` instead.

### Step 4: Evaluate

Invoke the `evaluator` agent. Pass:
- Sprint contract
- Generator output summary
- Note if Playwright MCP is available for web projects

Single pass -- no loop. If FAIL, report failures and stop. The user should refine the spec or switch to `/build` for iterative work.

### Step 5: Security

Invoke the `security` agent on the diff. If critical issues are found:
- Invoke the `generator` agent once more with only those issues to fix
- Re-run the `evaluator` on the security fixes

Non-critical findings are noted in the report but don't block.

### Step 6: Simplify

Invoke the `/simplify` skill on the changed files.

### Step 7: Git result

**Default:** invoke the `commit-commands:commit-push-pr` skill.

**`--no-pr`:** invoke the `commit-commands:commit` skill only.

**If `--worktree`:** after PR is open, clean up:
```
git worktree remove /tmp/<branch-name>
```

## Output

```
Make: <feature name>
Branch: <name>

[research]  ✓
[generate]  ✓ <files changed>
[evaluate]  ✓ / ✗ <result>
[security]  ✓ / ⚠ <N findings>
[simplify]  ✓

PR: <url>   (or Committed: <hash>)
```

## Cookbook

<If: evaluate returns FAIL>
<Then: stop. Report the failing criteria. Don't run security or simplify on broken output. The user should fix the spec or switch to /build for iterative refinement.>

<If: spec is too large to implement in one session>
<Then: stop at Step 3 and tell the user. Suggest /build with the same spec. Don't try to partial-implement a scope that needs sprint decomposition.>

<If: security finds a critical issue that the generator can't fix without touching unrelated code>
<Then: note it in the report as a blocker, open the PR as a draft, and flag for manual review.>

<If: --current and --no-pr are both set>
<Then: work in place, commit only. Useful for committing a feature to an existing branch mid-session.>
