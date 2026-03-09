---
name: branch
description: >
  Automates feature branch creation from spec files or direct branch names.
  Triggers: "create a branch", "branch for this spec", "start a feature branch",
  "branch this", "create branch from spec".
  Do NOT use for committing (use commit skill).
  Do NOT use for creating PRs (use pr skill).
---

# Purpose

Create a properly named feature branch from a spec file or direct branch name,
based on the latest remote base branch (main/master).

# Variables

- `SPEC_OR_BRANCH`: A spec file path (e.g., `specs/feat-user-auth.md`) or a direct branch name (e.g., `feat/my-feature`).
- `BASE_BRANCH`: Auto-detected via `git remote show origin` (typically `main` or `master`).

# Instructions

1. **Determine the branch name.**
   - If the argument is a file path (contains `/` with a file extension or matches `specs/`):
     - Extract the filename without extension.
     - Split on the first `-` to get the prefix and the rest: `feat-user-auth` -> `feat/user-auth`, `fix-login-bug` -> `fix/login-bug`.
   - If the argument is already in `prefix/name` format, use it directly.
   - If no argument is provided, look for spec files in the current directory or ask the user.

2. **Validate the branch name.**
   - Must start with a recognized prefix: `feat/`, `fix/`, `chore/`, `docs/`, `refactor/`, `test/`, `ci/`.
   - Must not contain spaces or special characters beyond `-`, `/`, `_`.

3. **Detect the base branch.**
   - Run `git remote show origin` and parse the `HEAD branch:` line.
   - Fall back to `main` if detection fails.

4. **Fetch the latest base branch.**
   - Run `git fetch origin <BASE_BRANCH>`.

5. **Create and switch to the new branch.**
   - Run `git checkout -b <BRANCH_NAME> origin/<BASE_BRANCH>`.

6. **Confirm success.**
   - Run `git branch --show-current` to verify.
   - Report the branch name and that it is ready for implementation.

# Workflow

```
Input (spec file or branch name)
  -> Parse branch name
  -> Validate format
  -> Detect base branch
  -> Fetch latest
  -> Create & checkout branch
  -> Confirm ready
```

# Cookbook

### From a spec file
```
User: "Create a branch for specs/feat-user-auth.md"
Action: Creates branch `feat/user-auth` from `origin/main`
```

### From a direct name
```
User: "Create branch fix/login-bug"
Action: Creates branch `fix/login-bug` from `origin/main`
```

### No argument, spec exists
```
User: "Branch this" (with specs/chore-cleanup.md in context)
Action: Creates branch `chore/cleanup` from `origin/main`
```

# Validation

- [ ] Branch name follows `prefix/name` format with a valid prefix.
- [ ] Base branch was detected and fetched successfully.
- [ ] `git branch --show-current` matches the intended branch name.
- [ ] No uncommitted changes were lost (warn if working tree is dirty).

# Examples

**Input:** `specs/feat-user-auth.md`
**Branch:** `feat/user-auth`

**Input:** `specs/fix-login-bug.md`
**Branch:** `fix/login-bug`

**Input:** `feat/my-feature`
**Branch:** `feat/my-feature`

**Input:** `specs/refactor-db-layer.md`
**Branch:** `refactor/db-layer`
