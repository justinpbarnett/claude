---
name: review
description: >
  Reviews implemented features against a specification file to verify the
  implementation matches requirements, then automatically fixes all blocker
  and tech_debt issues found. Compares git diffs with spec criteria,
  optionally captures screenshots of critical UI paths, classifies issues
  by severity, fixes actionable issues in-place, and produces a structured
  JSON report. Use when a user wants to review work against a spec, validate
  an implementation, check if features match requirements, or verify work
  before merging. Triggers on "review the spec", "review my work", "validate
  against the spec", "check the implementation", "review this feature",
  "does this match the spec", "spec review", "review before merge". Do NOT
  use for implementing features (use the implement skill). Do NOT use for
  creating or writing specs (use the spec skill). Do NOT use for running
  tests or linting directly.
---

# Purpose

Reviews implemented features against a specification file, classifies issues by severity, and **automatically fixes all blocker and tech_debt issues**. Produces a structured JSON report reflecting the final state after fixes.

## Variables

- `argument` -- Optional spec file path (e.g., `specs/feat-user-auth.md`). If omitted, the skill discovers the spec from the current branch name.

## Instructions

### Step 1: Determine the Spec File

Identify which spec to review against:

- **Explicit path** -- If the user provides a spec file path, use it directly.
- **Branch-based discovery** -- If no spec is provided, run `git branch --show-current` to get the current branch name, then search `specs/` for a matching file.
- **Ambiguous** -- If multiple specs match or none match, list available specs in `specs/` and ask the user to confirm which one to review against.

### Step 2: Determine the Base Branch

Detect the default branch:

```bash
git remote show origin 2>/dev/null | grep 'HEAD branch' | sed 's/.*: //'
```

Falls back to `main` if detection fails.

### Step 3: Gather Context

Run these commands to understand what was built:

1. `git branch --show-current` -- Identify the working branch
2. `git diff origin/<base-branch>` -- See all changes made relative to base. Continue the review even if the diff is empty.
3. Read the identified spec file thoroughly. Extract:
   - Required features and acceptance criteria
   - UI/UX requirements (if any)
   - API or backend requirements (if any)
   - Edge cases or constraints mentioned

### Step 4: Determine Review Strategy

Based on the spec requirements, decide which review paths apply:

- **Code review** -- Always performed. Compare the git diff against spec requirements to verify all stated criteria are addressed.
- **UI review** -- Performed only if the spec describes user-facing features (pages, components, visual elements). Requires the application to be running and a browser automation tool to be available.

If UI review is needed, proceed to Step 5. Otherwise, skip to Step 6.

### Step 5: UI Review with Screenshots

This step validates visible functionality.

#### 5a: Prepare the Application

Check if a dev server is already running. If not, start one using the project's start command (discover from justfile, package.json, Makefile, etc.). Start it in the background and track the PID. After screenshots are captured in Step 5b, kill the dev server process to avoid leaving orphaned processes.

#### 5b: Capture Screenshots

Use available browser automation (Playwright MCP or similar) to navigate the application and capture screenshots:

- Navigate to the critical paths described in the spec
- Capture **1-5 targeted screenshots** that demonstrate the implemented functionality
- Focus on critical functionality -- avoid screenshots of routine or unchanged areas
- If an issue is found, capture a screenshot of the issue specifically

Screenshot naming convention: `01_descriptive_name.png`, `02_descriptive_name.png`, etc.
Screenshot storage: Store screenshots in the `review_img/` directory. Create the directory if it does not exist.

#### 5c: Compare Against Spec

For each spec requirement with a UI component:
- Verify the visual implementation matches the described behavior
- Check layout, content, interactions, and error states as described
- Note any discrepancies as review issues

### Step 6: Classify Issues

For each issue found during review, classify its severity using the guidelines in `references/severity-guide.md`:

- **blocker** -- Prevents release. The feature does not function as specified or will harm the user experience.
- **tech_debt** -- Does not prevent release but creates debt that should be addressed in a future iteration.
- **skippable** -- Non-blocking and minor. A real problem but not critical to the feature's core value.

Think carefully about impact before classifying. When in doubt, lean toward the less severe classification.

### Step 7: Fix All Actionable Issues

**This is the key step.** After classifying all issues, fix every `blocker` and `tech_debt` issue directly in the code.

For each issue:

1. Locate the relevant file(s) and code
2. Apply the fix described in the issue's resolution
3. Verify the fix doesn't break other functionality
4. Mark the issue as `fixed: true` in the report

**Rules:**
- Fix `blocker` issues first, then `tech_debt`
- `skippable` issues are NOT fixed -- they are reported only
- If a fix would require architectural changes beyond the scope of the current spec, reclassify it as `tech_debt` with `fixed: false` and explain why in `fix_note`
- After all fixes are applied, run the project's build/compile command to verify nothing is broken. Fix any build errors introduced by the fixes.

### Step 8: Produce the Report

Output the review result as a JSON object. Return ONLY the JSON -- no surrounding text, markdown formatting, or explanation. The output must be valid for `JSON.parse()`.

Use the schema defined in `references/output-schema.json`.

```json
{
  "success": true,
  "review_summary": "2-4 sentence summary of what was built, whether it matches the spec, and what was fixed.",
  "issues_found": 3,
  "issues_fixed": 2,
  "review_issues": [],
  "screenshots": []
}
```

Key rules:
- `success` is `true` if there are no unfixed `blocker` issues remaining
- `success` is `false` ONLY if there are `blocker` issues that could not be fixed
- After fixing, `success` should almost always be `true`
- `issues_found` is the total count of issues discovered during review
- `issues_fixed` is the count of issues that were successfully fixed
- `review_summary` should describe what was reviewed, what issues were found, and what was fixed
- All paths must be absolute

## Workflow

1. **Determine spec** -- Find the spec file from argument or branch-based discovery
2. **Base branch** -- Detect the default branch
3. **Gather context** -- Collect git diff and extract spec requirements
4. **Review strategy** -- Decide code-only or code + UI review
5. **UI review** -- If needed: start app, capture screenshots, compare against spec
6. **Classify** -- Assign severity to each issue found
7. **Fix** -- Automatically fix all blocker and tech_debt issues
8. **Verify** -- Run build to confirm fixes don't break anything
9. **Report** -- Produce a JSON report with summary, issues (with fix status), and screenshots

## Cookbook

<If: no spec file found matching the current branch>
<Then: list all files in `specs/` and ask the user to specify which spec to review against>

<If: browser automation not available>
<Then: skip UI review. Perform code-only review and note in the `review_summary` that visual validation was not performed. Do not fail the review for this reason.>

<If: application fails to start for UI review>
<Then: attempt to install dependencies first. If still failing, skip UI review and note it in the summary. Code review can still proceed.>

<If: git diff is empty>
<Then: continue the review. Check `git status` for uncommitted changes. If there truly are no changes, note this in the summary but still verify whether the current codebase satisfies the spec.>

<If: no issues found>
<Then: skip directly to the report. Output `"success": true` with empty `review_issues` array and `issues_found: 0`, `issues_fixed: 0`.>

<If: a fix would break other functionality>
<Then: do not apply the fix. Mark the issue as `fixed: false` with a `fix_note` explaining the risk. Reclassify as `tech_debt` if it was a `blocker` that can't be safely fixed.>

<If: unsure about issue severity>
<Then: lean toward the less severe classification. Over-classifying as `blocker` creates unnecessary churn.>

<If: changes touch authentication, authorization, input validation, or data handling>
<Then: use the `security` agent to run a focused OWASP vulnerability scan on the changed files before finalizing the review.>

## Validation

Before finalizing the report, verify:

- Every spec requirement has been checked against the implementation
- All `blocker` and `tech_debt` issues have been fixed (or have a `fix_note` explaining why not)
- The build passes after all fixes are applied
- Screenshots clearly demonstrate the critical functionality paths (if UI review was performed)
- The JSON output is valid and parseable
- All file paths in the output are absolute

## Examples

### Example 1: Review with fixable issues

**Spec:** `specs/feat-user-auth.md`

**Actions:**

1. Read spec, gather git diff
2. Find 1 blocker (missing auth check on /admin route) and 1 tech_debt (hardcoded session timeout)
3. Fix both: add auth middleware to /admin route, extract session timeout to config
4. Run build to verify fixes
5. Output JSON report with `"success": true`, `issues_found: 2`, `issues_fixed: 2`

### Example 2: Clean review -- no issues

**Spec:** `specs/fix-health-endpoint.md`

**Actions:**

1. Read spec, gather git diff
2. All requirements met, no issues found
3. Output JSON report with `"success": true`, `issues_found: 0`, `issues_fixed: 0`

### Example 3: Review with unfixable blocker

**Spec:** `specs/feat-multi-tenant.md`

**Actions:**

1. Read spec, gather git diff
2. Find 1 blocker (data isolation between tenants requires schema refactor)
3. Attempt fix but determine it requires architectural changes beyond scope
4. Mark as `fixed: false` with `fix_note` explaining the scope
5. Output JSON report with `"success": false`, `issues_found: 1`, `issues_fixed: 0`
