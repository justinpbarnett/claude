---
name: implement
description: >
  Implements a development plan by reading it, breaking it into tasks,
  writing the code, and reporting a summary of completed work. Use when
  a user wants to implement, execute, build, or code a plan. Triggers on
  "implement this plan", "execute this spec", "build this feature from
  the plan", "code this up", "follow this plan", "implement the spec",
  or when given a spec file path or inline plan text. Do NOT use for
  creating or writing specs (use the spec skill instead). Do NOT use for
  reviewing, critiquing, or modifying existing plans without implementing
  them. Do NOT use for running or deploying applications.
---

# Purpose

Executes a development plan by methodically reading the spec, implementing each task in dependency order, running the full validation suite, and reporting a concise summary of completed work with change statistics.

## Variables

- `argument` - Spec file path (e.g., `specs/feat-user-auth.md`) or inline plan text.

## Instructions

### Step 1: Parse the Plan

Determine the plan source from the user's input:

- **Spec file path** - If the user provides a path (e.g., `specs/feat-user-auth.md`), read that file.
- **Inline plan text** - If the user provides the plan directly as text, use it as-is.
- **Ambiguous reference** - If the user says "implement the plan" without specifying which one, check `specs/` for recent plans and ask the user to confirm which one.

Read the plan thoroughly. Identify:

1. **Scope** - What is being built, fixed, or changed?
2. **Tasks** - What are the discrete implementation steps?
3. **Dependencies** - What order must tasks be completed in?
4. **Relevant files** - What existing files will be modified or referenced?
5. **New files** - What files need to be created?

### Step 2: Research Before Coding

Before writing any code, build context:

1. Read every file listed in the plan's "Relevant Files" section (or equivalent)
2. Understand the patterns, conventions, and architecture already in use
3. Identify any conflicts between the plan and current codebase state
4. If the plan references files that don't exist or have changed significantly since the plan was written, pause and inform the user

**Drift detection:** Before writing code, verify the spec is still accurate:
1. For each file in the spec's "Relevant Files" section, check if it still exists
2. If the spec file has a timestamp or was created on a branch, compare file modification times
3. Run a targeted grep for key functions, types, or variables mentioned in the spec to verify they still exist at the expected locations
4. If drift is detected (files moved, renamed, deleted, or significantly changed), warn the user with specifics before proceeding. Ask if they want to continue or update the spec first.

**Delegation:** For complex implementations where the codebase is large or unfamiliar, delegate to the **research agent** for deeper codebase investigation before starting implementation.

### Step 3: Implement

Work through the plan's tasks in dependency order:

- **One task at a time** - Complete each task fully before moving to the next
- **Follow existing patterns** - Match the codebase's style, naming conventions, and architectural patterns
- **Prefer editing over creating** - Modify existing files when possible rather than creating new ones
- **Self-documenting code** - Write clear, readable code rather than adding comments
- **Quick compile check** - After completing a logical chunk of work, verify the code compiles (e.g., `go build ./...`, `tsc --noEmit`, `python -c "import module"`) to catch syntax errors early.

### Step 4: Run Validation Suite

After all tasks are implemented, run the project's full validation suite:

1. Discover the validation command - check for `make check`, `just check`, `npm run check`, or fall back to running lint and test commands separately
2. Run the full suite (e.g., `make check`, `go test ./...`, `npm test`)
3. If any tests fail, diagnose the root cause and fix:
   - **Lint/type errors** - fix the code to satisfy the linter or type checker
   - **Test failures from implementation bugs** - fix the implementation, not the test
   - **Test failures from outdated expectations** - update the test to match new correct behavior (e.g., golden files, snapshots)
4. Re-run after each fix to confirm. **Maximum 3 fix attempts** - if tests still fail after 3 rounds, note the remaining failures in the report
5. Only proceed to the next step after validation passes or max attempts are exhausted

**Delegation:** After implementation, if the spec mentions testing requirements, delegate to the **test-gen agent** to generate tests for the new or changed code.

### Step 5: Report

Summarize the completed work:

1. **Bullet point summary** - Concise list of what was implemented
2. **Change statistics** - Run `git diff --stat` and include the output showing files changed and lines added/removed

Format the report as:

```
## Summary

- [What was done, one bullet per logical change]

## Changes

[Output of git diff --stat]
```

## Workflow

1. **Parse** - Read the plan, identify scope, tasks, dependencies, and files
2. **Research** - Read all relevant files to understand current codebase state
3. **Implement** - Execute tasks in dependency order, compile-checking after each chunk
4. **Validate** - Run the full test/lint suite, fix failures (up to 3 attempts)
5. **Report** - Bullet summary + `git diff --stat`

## Cookbook

<If: plan references files that no longer exist>
<Then: inform the user of the discrepancy. Suggest either updating the plan or adapting the implementation to the current state. Do not silently ignore missing files.>

<If: code doesn't compile after a chunk of work>
<Then: fix the compilation error before moving to the next task. Only fix what's needed to compile. Save full validation for Step 4.>

<If: plan is ambiguous or incomplete>
<Then: ask the user for clarification on specific ambiguous points. Do not guess at requirements. It's faster to ask than to implement the wrong thing and redo it.>

<If: plan conflicts with codebase conventions>
<Then: follow the codebase conventions, not the plan. Note the deviation in the report.>

<If: implementation reveals the plan missed something>
<Then: implement what's needed to make the feature work, note the addition in the report>

## Validation

Before reporting completion, verify:

- All plan tasks have been addressed
- Full validation suite passes (or failures are documented after 3 fix attempts)
- No placeholder or TODO code was left behind
- If on the default branch (main/master), warn in the report that changes were made directly on main

## Examples

### Example 1: Implementing a Spec File

**User says:** "Implement specs/feat-user-auth.md"

**Actions:**

1. Read `specs/feat-user-auth.md`
2. Identify tasks, relevant files, and dependencies
3. Read all relevant files to understand current state
4. Implement each task in order, compile-checking after each chunk
5. Review that changes match the plan
6. Report summary and `git diff --stat`

### Example 2: Implementing an Inline Plan

**User says:** "Implement this plan: Add a /health endpoint that returns JSON with status and database connectivity check"

**Actions:**

1. Parse inline plan text
2. Research: read existing route structure and patterns
3. Implement the endpoint following existing patterns
4. Compile-check to verify no syntax errors
5. Run validation suite
6. Report summary and `git diff --stat`

### Example 3: Implementing from Context

**User says:** "Implement the plan we just created"

**Actions:**

1. Check recent conversation for a plan, or look in `specs/` for the most recent file
2. If ambiguous, ask the user to confirm which plan
3. Proceed with implementation as in Example 1
