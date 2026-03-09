---
name: pipeline
description: >
  Chains the full development workflow into a single autonomous execution:
  branch, research, implement, test, generate tests, security check, review
  (with auto-fix), simplify, commit, and PR. Accepts a spec file path or
  inline task description. Supports --from and --to flags to start or stop
  at specific steps, and --draft to create a draft PR. Use when a user wants
  to "ship this", "pipeline this spec", "run the full pipeline", "end to end",
  "ship it", or "full workflow". Do NOT use for individual steps (use the
  specific skill instead, e.g., /commit, /review, /pr).
---

# Purpose

Orchestrates the complete development workflow as a single autonomous pipeline. Takes a spec file or inline task description and drives it through branching, research, implementation, testing, test generation, security scanning, review with auto-fix, simplification, atomic commits, and PR creation -- stopping only on unrecoverable errors.

## Variables

- `argument` -- Spec file path (e.g., `specs/feat-user-auth.md`) or inline task description (e.g., `"add a /health endpoint that returns JSON status"`).
- `--from=<step>` -- Start from a specific step, skipping earlier ones. Valid values: `branch`, `research`, `implement`, `test`, `test-gen`, `security`, `review`, `simplify`, `commit`, `pr`. Assumes prior steps were already completed.
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
   - `--from=review` means skip steps 1-6 (branch through security) and start at review.
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

### Step 3: Implement

**Skill:** `/implement`

Pass the spec file path or inline task description to the implement skill. It reads the plan, implements each task in dependency order, runs a compile check, and validates.

**Skip condition:** Skip if `--from` is set to a later step.

### Step 4: Test

**Skill:** `/test`

Run the project's full validation suite (lint, type check, unit tests, e2e). The test skill auto-fixes failures up to 3 attempts.

If tests fail after 3 fix attempts, **stop the pipeline** and report:
- Which steps completed successfully
- Which tests are still failing
- The error output from the failing tests

**Skip condition:** Skip if `--from` is set to a later step.

### Step 5: Generate Tests

**Agent:** `test-gen`

Use the test-gen agent to analyze the diff and generate tests for any new code that lacks corresponding test coverage. After test generation, re-run the test skill to verify the new tests pass.

If newly generated tests fail, fix them (up to 2 attempts). If they still fail after fixes, remove the broken tests and note this in the final report rather than blocking the pipeline.

**Skip condition:** Skip if `--from` is set to a later step.

### Step 6: Security Check

**Agent:** `security`

Use the security agent to scan the diff for vulnerabilities -- hardcoded secrets, injection risks, insecure defaults, missing auth checks, etc.

If the security agent finds critical issues:
- Fix them immediately
- Re-run the test skill to verify fixes don't break anything
- If a security fix cannot be resolved without architectural changes, **stop the pipeline** and report the security finding

Non-critical security suggestions are noted in the final report but do not block the pipeline.

**Skip condition:** Skip if `--from` is set to a later step.

### Step 7: Review

**Skill:** `/review`

Run the review skill against the spec. The review skill automatically fixes blocker and tech_debt issues. After review fixes are applied, re-run `/test` to confirm nothing broke.

If the review reports `"success": false` (unfixed blockers remain), **stop the pipeline** and report the blocking issues.

**Skip condition:** Skip if `--from` is set to a later step.

### Step 8: Simplify

**Skill:** `/simplify`

Run the simplify skill to clean up the implementation -- reduce duplication, improve naming, simplify logic, and ensure code quality. After simplification, re-run `/test` to confirm the cleanup didn't break anything.

**Skip condition:** Skip if `--from` is set to a later step.

### Step 9: Commit

**Skill:** `/commit`

Run the commit skill to create atomic conventional commits grouped by logical concern.

**Skip condition:** Skip if `--from` is set to a later step, or if `--to` was set to a step before this one.

### Step 10: PR

**Skill:** `/pr`

Push and create the PR. If a spec file was provided, pass it to the PR skill so it enriches the PR body with spec context. If `--draft` was specified, create a draft PR.

**Skip condition:** Skip if `--to` was set to a step before this one.

Report the PR URL as the final output.

## Workflow

```
Parse Input
  │
  ├──→ Step 1:  Branch        (/branch skill)
  │
  ├──→ Step 2:  Research      (research agent)
  │
  ├──→ Step 3:  Implement     (/implement skill)
  │
  ├──→ Step 4:  Test          (/test skill)
  │
  ├──→ Step 5:  Generate Tests (test-gen agent + /test)
  │
  ├──→ Step 6:  Security      (security agent + fix + /test)
  │
  ├──→ Step 7:  Review        (/review skill + /test)
  │
  ├──→ Step 8:  Simplify      (/simplify skill + /test)
  │
  ├──→ Step 9:  Commit        (/commit skill)
  │
  └──→ Step 10: PR            (/pr skill)
         │
         └──→ Done -- report PR URL
```

Each step reports its status before moving to the next:

```
[step N/10] <step name> ✓ completed
```

If a step fails and cannot recover:

```
[step N/10] <step name> ✗ failed -- <reason>
Pipeline stopped. Steps 1-<N-1> completed successfully.
```

## Cookbook

<If: --from flag is used (e.g., --from=review)>
<Then: skip all steps before the specified step. Assume the user has already completed prior steps manually. Validate that the working tree is in a reasonable state (e.g., on a feature branch, changes exist) before starting from the specified step.>

<If: --to flag is used (e.g., --to=commit)>
<Then: execute all steps up to and including the specified step, then stop. Report what was completed and note that remaining steps were skipped by request.>

<If: input is an inline task description (not a spec file)>
<Then: use the inline description as the plan for the implement skill. Derive the branch name from the description. For the review step, review the diff against the inline description rather than a spec file.>

<If: spec file is too large or covers multiple features>
<Then: suggest using the /decompose skill first to break the spec into sub-tasks. Do not attempt to pipeline a spec that should be decomposed -- the quality of each step degrades with oversized specs. Stop and advise the user.>

<If: pipeline was interrupted (e.g., user stopped it, session ended)>
<Then: use --from to resume from the last incomplete step. Check git log and git status to determine what was already done. For example, if commits exist but no PR was created, use --from=pr to finish.>

<If: test failures persist after 3 fix attempts in Step 4>
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

### Example 1: Full Pipeline from Spec File

**User says:** "Ship this specs/feat-user-auth.md"

**Actions:**

1. Parse: spec file `specs/feat-user-auth.md`, full pipeline, no flags
2. Branch: create `feat/user-auth` from origin/main
3. Research: investigate auth patterns, middleware, user model
4. Implement: execute the spec tasks in order
5. Test: run full validation suite, fix any failures
6. Generate tests: test-gen agent adds missing test coverage, verify tests pass
7. Security: scan for auth vulnerabilities (hardcoded secrets, missing checks)
8. Review: review diff against spec, auto-fix issues
9. Simplify: clean up implementation
10. Commit: create atomic conventional commits
11. PR: push and create PR with spec reference
12. Report: `https://github.com/user/repo/pull/42`

### Example 2: Inline Task with Draft PR

**User says:** "Pipeline this: add a /health endpoint that returns JSON with status and db check --draft"

**Actions:**

1. Parse: inline task, derive branch `feat/add-health-endpoint`, draft PR
2. Branch: create `feat/add-health-endpoint`
3. Research: investigate existing routes and health check patterns
4. Implement: add health endpoint following existing route patterns
5. Test: run validation suite
6. Generate tests: add test for the health endpoint
7. Security: scan endpoint for information disclosure risks
8. Review: verify endpoint works as described
9. Simplify: clean up
10. Commit: `feat: add health endpoint with db connectivity check`
11. PR: create draft PR
12. Report: `https://github.com/user/repo/pull/43` (draft)

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
4. Implement: apply the fix
5. Test: run validation suite
6. Generate tests: add regression test for the login bug
7. Security: scan for auth-related issues
8. Review: verify fix addresses the bug
9. Simplify: clean up
10. Commit: create atomic commits
11. Report: pipeline complete through commit. PR skipped (--to=commit).

### Example 5: Pipeline Stops on Test Failure

**User says:** "Ship specs/feat-payments.md"

**Actions:**

1. Branch: create `feat/payments`
2. Research: investigate payment integration patterns
3. Implement: add payment processing
4. Test: run validation -- 2 failures after 3 fix attempts
5. **Pipeline stopped.**

**Report:**

```
Pipeline stopped at Step 4 (test).

Completed:
  [1/10] branch      ✓ feat/payments
  [2/10] research    ✓ gathered context
  [3/10] implement   ✓ payment processing added
  [4/10] test        ✗ 2 failures after 3 fix attempts

Failing tests:
  - unit_tests: TestPaymentProcessor_Refund -- expected refund amount mismatch
  - e2e_tests: TestCheckoutFlow -- timeout waiting for payment callback

Remaining steps not executed: test-gen, security, review, simplify, commit, pr
```
