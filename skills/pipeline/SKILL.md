---
name: pipeline
description: >
  Chains the full development workflow into a single autonomous execution:
  branch, research, decompose, implement (parallel by stage), test, generate
  tests, security check, review (with auto-fix), simplify, commit, and PR.
  Accepts a spec file path or inline task description. Supports --from and
  --to flags to start or stop at specific steps, and --draft to create a
  draft PR. Use when a user wants to "ship this", "pipeline this spec",
  "run the full pipeline", "end to end", "ship it", or "full workflow".
  Do NOT use for individual steps (use the specific skill instead, e.g.,
  /commit, /review, /pr).
---

# Purpose

Orchestrates the complete development workflow as a single autonomous pipeline. Takes a spec file or inline task description and drives it through branching, research, decomposition, parallel implementation, testing, test generation, security scanning, review with auto-fix, simplification, atomic commits, and PR creation -- stopping only on unrecoverable errors.

## Variables

- `argument` -- Spec file path (e.g., `specs/feat-user-auth.md`) or inline task description (e.g., `"add a /health endpoint that returns JSON status"`).
- `--from=<step>` -- Start from a specific step, skipping earlier ones. Valid values: `branch`, `research`, `decompose`, `implement`, `test`, `test-gen`, `security`, `review`, `simplify`, `commit`, `pr`. Assumes prior steps were already completed.
- `--to=<step>` -- Stop after a specific step. Valid values: same as `--from`. Useful for partial runs (e.g., `--to=commit` to skip PR creation).
- `--draft` -- Create the PR as a draft instead of ready for review.

## Instructions

### Step 0: Parse Input and Determine Step Range

Parse the user's input to extract:

1. **Spec source** -- Determine if the argument is a file path or inline text:
   - If it contains a path separator and ends with `.md`, treat as a spec file path. Read the file.
   - Otherwise, treat as an inline task description.
   - If no argument is provided, check `specs/` for recent specs and ask the user to confirm.

2. **Step range** -- Parse `--from` and `--to` flags if present:
   - Default range is all steps: branch through pr.
   - `--from=review` means skip steps 1-7 (branch through security) and start at review.
   - `--to=commit` means execute through commit and stop before pr.
   - Validate that `--from` comes before or equals `--to` in the step order.

3. **Draft flag** -- If `--draft` is present, pass it to the PR step.

Report the plan before executing:

```
Pipeline: <spec name or task summary>
Steps:    <first step> → <last step>
Draft PR: yes/no
```

### Step 1: Branch

**Skill:** `/branch`

Create a feature branch from the spec file or task description. If the input is a spec file, pass it directly to the branch skill. If the input is inline text, derive a branch name from the task description (e.g., `"add health endpoint"` becomes `feat/add-health-endpoint`).

**Skip condition:** Skip if `--from` is set to a later step, or if already on a non-default feature branch.

### Step 2: Research

**Agent:** `research`

Use the research agent to gather deep context on the codebase before coding. Pass the spec or task description so it knows what to investigate. This step builds understanding of relevant files, patterns, and architecture that will inform the implementation.

**Skip condition:** Skip if `--from` is set to a later step.

### Step 3: Decompose

**Skill:** `/decompose`

Run the decompose skill on the spec to determine whether it should be broken into sub-tasks. Pass the spec file path (or inline description) to decompose.

- If decompose returns `is_decomposed: false`, the spec is small enough for a single implementation pass. Proceed to Step 4 with the original spec.
- If decompose returns `is_decomposed: true`, it produces a task graph with staged sub-tasks and mini-spec files. Store the task graph for Step 4.

**Skip condition:** Skip if `--from` is set to a later step. Also skip if the input is a short inline task description (one sentence or less) -- these are always single-task.

### Step 4: Implement

**Skill:** `/implement` (possibly in parallel via Agent tool)

Implementation depends on whether decomposition occurred:

#### Single task (not decomposed)

Pass the spec file path or inline task description to the implement skill directly. It reads the plan, implements each task in dependency order, runs a compile check, and validates.

#### Decomposed (parallel by stage)

Execute sub-tasks from the task graph stage by stage:

1. **Stage 1** -- Launch an Agent (subagent_type: `general-purpose`) for each stage-1 sub-task, all in parallel. Each agent runs `/implement` on its mini-spec file. Wait for all stage-1 agents to complete.
2. **Stage 2** -- Launch agents for all stage-2 sub-tasks in parallel. Wait for completion.
3. **Continue** through all stages in order.

After all stages complete, run a compile check on the full project to catch any integration issues between parallel sub-tasks. Fix any integration errors before proceeding.

**Important:** Each parallel agent gets its own mini-spec file path. The agent runs `/implement <mini-spec-path>` and returns its summary. Collect all summaries for the final report.

**Skip condition:** Skip if `--from` is set to a later step.

### Step 5: Test

**Skill:** `/test`

Run the project's full validation suite (lint, type check, unit tests, e2e). The test skill auto-fixes failures up to 3 attempts.

If tests fail after 3 fix attempts, **stop the pipeline** and report:
- Which steps completed successfully
- Which tests are still failing
- The error output from the failing tests

**Skip condition:** Skip if `--from` is set to a later step.

### Step 6: Generate Tests

**Agent:** `test-gen`

Use the test-gen agent to analyze the diff and generate tests for any new code that lacks corresponding test coverage. After test generation, re-run the test skill to verify the new tests pass.

If newly generated tests fail, fix them (up to 2 attempts). If they still fail after fixes, remove the broken tests and note this in the final report rather than blocking the pipeline.

**Skip condition:** Skip if `--from` is set to a later step.

### Step 7: Security Check

**Agent:** `security`

Use the security agent to scan the diff for vulnerabilities -- hardcoded secrets, injection risks, insecure defaults, missing auth checks, etc.

If the security agent finds critical issues:
- Fix them immediately
- Re-run the test skill to verify fixes don't break anything
- If a security fix cannot be resolved without architectural changes, **stop the pipeline** and report the security finding

Non-critical security suggestions are noted in the final report but do not block the pipeline.

**Skip condition:** Skip if `--from` is set to a later step.

### Step 8: Review

**Skill:** `/review`

Run the review skill against the spec. The review skill automatically fixes blocker and tech_debt issues. After review fixes are applied, re-run `/test` to confirm nothing broke.

If the review reports `"success": false` (unfixed blockers remain), **stop the pipeline** and report the blocking issues.

**Skip condition:** Skip if `--from` is set to a later step.

### Step 9: Simplify

**Skill:** `/simplify`

Run the simplify skill to clean up the implementation -- reduce duplication, improve naming, simplify logic, and ensure code quality. After simplification, re-run `/test` to confirm the cleanup didn't break anything.

**Skip condition:** Skip if `--from` is set to a later step.

### Step 10: Commit

**Skill:** `/commit`

Run the commit skill to create atomic conventional commits grouped by logical concern.

**Skip condition:** Skip if `--from` is set to a later step, or if `--to` was set to a step before this one.

### Step 11: PR

**Skill:** `/pr`

Push and create the PR. If a spec file was provided, pass it to the PR skill so it enriches the PR body with spec context. If `--draft` was specified, create a draft PR.

**Skip condition:** Skip if `--to` was set to a step before this one.

Report the PR URL as the final output.

## Workflow

```
Parse Input
  │
  ├──→ Step 1:  Branch         (/branch skill)
  │
  ├──→ Step 2:  Research       (research agent)
  │
  ├──→ Step 3:  Decompose      (/decompose skill)
  │                │
  │         ┌──────┴──────┐
  │         │             │
  │    not decomposed  decomposed
  │         │             │
  ├──→ Step 4:  Implement  │ single /implement
  │         │             │ OR parallel agents by stage:
  │         │             │   Stage 1: [task-a] [task-b] (parallel)
  │         │             │   Stage 2: [task-c] [task-d] (parallel)
  │         │             │   Stage N: ...
  │         └──────┬──────┘
  │                │
  ├──→ Step 5:  Test           (/test skill)
  │
  ├──→ Step 6:  Generate Tests (test-gen agent + /test)
  │
  ├──→ Step 7:  Security       (security agent + fix + /test)
  │
  ├──→ Step 8:  Review         (/review skill + /test)
  │
  ├──→ Step 9:  Simplify       (/simplify skill + /test)
  │
  ├──→ Step 10: Commit         (/commit skill)
  │
  └──→ Step 11: PR             (/pr skill)
         │
         └──→ Done -- report PR URL
```

Each step reports its status before moving to the next:

```
[step N/11] <step name> ✓ completed
```

If a step fails and cannot recover:

```
[step N/11] <step name> ✗ failed -- <reason>
Pipeline stopped. Steps 1-<N-1> completed successfully.
```

## Cookbook

<If: --from flag is used (e.g., --from=review)>
<Then: skip all steps before the specified step. Assume the user has already completed prior steps manually. Validate that the working tree is in a reasonable state (e.g., on a feature branch, changes exist) before starting from the specified step.>

<If: --to flag is used (e.g., --to=commit)>
<Then: execute all steps up to and including the specified step, then stop. Report what was completed and note that remaining steps were skipped by request.>

<If: input is an inline task description (not a spec file)>
<Then: use the inline description as the plan for the implement skill. Derive the branch name from the description. For the review step, review the diff against the inline description rather than a spec file.>

<If: a parallel implementation agent fails>
<Then: collect the error from the failed agent. Attempt to fix the issue in the main context. If the fix is straightforward (compilation error, missing import), apply it and continue. If the failure is fundamental, stop the pipeline and report which sub-tasks succeeded and which failed.>

<If: pipeline was interrupted (e.g., user stopped it, session ended)>
<Then: use --from to resume from the last incomplete step. Check git log and git status to determine what was already done. For example, if commits exist but no PR was created, use --from=pr to finish.>

<If: test failures persist after 3 fix attempts in Step 5>
<Then: stop the pipeline immediately. Report which tests failed, the error output, and which steps completed. The user needs to intervene manually. Do not proceed to later steps with failing tests.>

<If: security agent finds critical vulnerabilities>
<Then: attempt to fix them. If the fix is straightforward (e.g., remove hardcoded secret, add input validation), apply it and re-test. If the fix requires architectural changes, stop the pipeline and report the finding with a recommendation.>

<If: review reports unfixed blockers>
<Then: stop the pipeline. The review skill already attempted to fix blockers -- if they remain unfixed, they require human decision-making. Report the blockers and suggest next steps.>

<If: already on a feature branch when branch step runs>
<Then: skip branch creation and use the current branch. Warn if the branch name doesn't match the spec name pattern.>

<If: no changes exist after implement step>
<Then: stop the pipeline and report that implementation produced no changes. The spec may already be implemented or may be invalid.>

## Validation

Before reporting completion, verify:

- All executed steps completed successfully
- The test suite passes (validated after every code-changing step)
- No security-critical issues remain unaddressed
- All changes are committed (no uncommitted changes remain)
- PR was created (unless `--to` excluded it) and URL is available
- No force-push or destructive git operations were performed at any point

## Examples

### Example 1: Full Pipeline from Spec File (Decomposed)

**User says:** "Ship this specs/feat-user-auth.md"

**Actions:**

1. Parse: spec file `specs/feat-user-auth.md`, full pipeline, no flags
2. Branch: create `feat/user-auth` from origin/main
3. Research: investigate auth patterns, middleware, user model
4. Decompose: spec is large -- decompose returns 4 sub-tasks across 3 stages
5. Implement (parallel):
   - Stage 1: Agent implements data model + migration
   - Stage 2: Agent implements auth service, Agent implements session middleware (parallel)
   - Stage 3: Agent implements login/signup routes
   - Integration compile check passes
6. Test: run full validation suite, fix any failures
7. Generate tests: test-gen agent adds missing test coverage, verify tests pass
8. Security: scan for auth vulnerabilities (hardcoded secrets, missing checks)
9. Review: review diff against spec, auto-fix issues
10. Simplify: clean up implementation
11. Commit: create atomic conventional commits
12. PR: push and create PR with spec reference
13. Report: `https://github.com/user/repo/pull/42`

### Example 2: Inline Task with Draft PR (Not Decomposed)

**User says:** "Pipeline this: add a /health endpoint that returns JSON with status and db check --draft"

**Actions:**

1. Parse: inline task, derive branch `feat/add-health-endpoint`, draft PR
2. Branch: create `feat/add-health-endpoint`
3. Research: investigate existing routes and health check patterns
4. Decompose: skipped (short inline task)
5. Implement: single pass, add health endpoint following existing route patterns
6. Test: run validation suite
7. Generate tests: add test for the health endpoint
8. Security: scan endpoint for information disclosure risks
9. Review: verify endpoint works as described
10. Simplify: clean up
11. Commit: `feat: add health endpoint with db connectivity check`
12. PR: create draft PR
13. Report: `https://github.com/user/repo/pull/43` (draft)

### Example 3: Resume from Review

**User says:** "/pipeline specs/feat-user-auth.md --from=review"

**Actions:**

1. Parse: spec file, start from review step
2. Validate: confirm on feature branch with changes
3. Review: review diff against spec, auto-fix issues
4. Simplify: clean up implementation
5. Commit: create atomic conventional commits
6. PR: push and create PR
7. Report: `https://github.com/user/repo/pull/44`

### Example 4: Pipeline to Commit Only

**User says:** "Run the full pipeline on specs/fix-login-bug.md --to=commit"

**Actions:**

1. Parse: spec file, stop after commit step
2. Branch: create `fix/login-bug`
3. Research: investigate login flow and bug context
4. Decompose: single task (small fix spec)
5. Implement: apply the fix
6. Test: run validation suite
7. Generate tests: add regression test for the login bug
8. Security: scan for auth-related issues
9. Review: verify fix addresses the bug
10. Simplify: clean up
11. Commit: create atomic commits
12. Report: pipeline complete through commit. PR skipped (--to=commit).

### Example 5: Pipeline Stops on Test Failure

**User says:** "Ship specs/feat-payments.md"

**Actions:**

1. Branch: create `feat/payments`
2. Research: investigate payment integration patterns
3. Decompose: 3 sub-tasks across 2 stages
4. Implement (parallel):
   - Stage 1: Agent implements payment model + service
   - Stage 2: Agent implements checkout route, Agent implements webhook handler (parallel)
5. Test: run validation -- 2 failures after 3 fix attempts
6. **Pipeline stopped.**

**Report:**

```
Pipeline stopped at Step 5 (test).

Completed:
  [1/11] branch      ✓ feat/payments
  [2/11] research    ✓ gathered context
  [3/11] decompose   ✓ 3 sub-tasks, 2 stages
  [4/11] implement   ✓ all sub-tasks completed (parallel)
  [5/11] test        ✗ 2 failures after 3 fix attempts

Failing tests:
  - unit_tests: TestPaymentProcessor_Refund -- expected refund amount mismatch
  - e2e_tests: TestCheckoutFlow -- timeout waiting for payment callback

Remaining steps not executed: test-gen, security, review, simplify, commit, pr
```
