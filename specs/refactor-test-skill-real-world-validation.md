# Refactor: Test Skill -- Real-World Validation

## Metadata

type: `refactor`
task_id: `test-skill-rwv`

## Background

The test skill at `/home/jpb/.claude/skills/test/SKILL.md` currently discovers and runs static validation (lint, typecheck, unit tests, e2e tests) from project config files. It follows the standard skill structure: frontmatter, Purpose, Variables, Instructions (4 steps), Workflow, Cookbook, Validation, Examples.

Static checks (lint, typecheck, unit tests) are better handled as hooks or manual commands -- they don't need a dedicated skill. The real value of a test skill is validating the application the way a real user would: running CLI commands, clicking through web UIs, hitting API endpoints.

The project uses a consistent skill structure defined in `skill-builder/references/frontmatter-guide.md`: YAML frontmatter with `name` and `description`, then Purpose, Variables, Instructions, Workflow, Cookbook, Validation, Examples sections. Skills produce JSON output for pipeline consumption using a standardized schema.

## Refactor Description

Replace the current test skill's static-check focus with a real-world validation approach. The skill will analyze git changes, build a test plan of happy paths and edge cases, then execute each test by using the application the way a real user would -- running built CLI binaries, driving web apps with Playwright, hitting API endpoints with real requests.

## Scope

### In Scope

- Rewriting SKILL.md to focus on real-world validation
- Change analysis via git diff to determine what to test
- Dynamic test plan generation (happy paths + edge cases)
- App type detection (CLI, web, API, library)
- Real-world test execution per app type
- Auto-fixing discovered bugs with re-validation
- User-specified scope narrowing/expanding
- JSON output compatible with the pipeline skill

### Out of Scope

- Running lint, typecheck, or unit test suites (those are hooks or manual commands)
- Generating new test files (that's the test-gen agent's job)
- Reviewing against a spec (that's the review skill)
- Starting dev servers permanently (that's the start skill) -- though the skill may start/stop servers transiently during testing

## Current State

The skill has 4 steps:
1. Discover test commands from justfile/package.json/Makefile/pyproject.toml
2. Execute tests (prefer combined `check`, otherwise parallel lint+typecheck+unit, then e2e)
3. Fix failures (up to 3 attempts)
4. Produce JSON report

It takes no arguments and always runs the full suite.

## Target State

The skill has 5 steps:
1. Analyze changes (git diff or user-specified scope) and detect app type
2. Build a test plan -- list of happy paths and edge cases as a visible checklist
3. Execute each test case by using the app as a real user would
4. Fix issues as discovered (3 attempts per case), re-validate each fix
5. Produce JSON report

It accepts an optional argument for scope control.

## Relevant Files

- `/home/jpb/.claude/skills/test/SKILL.md` -- the file being rewritten
- `/home/jpb/.claude/skills/review/SKILL.md` -- reference for change analysis patterns (it diffs against specs)
- `/home/jpb/.claude/skills/implement/SKILL.md` -- reference for build step patterns
- `/home/jpb/.claude/skills/pipeline/SKILL.md` -- consumes test skill output, defines the JSON contract
- `/home/jpb/.claude/skills/skill-builder/SKILL.md` -- authoritative skill structure definition
- `/home/jpb/.claude/skills/skill-builder/references/frontmatter-guide.md` -- frontmatter rules

## Decisions

| Decision | Choice | Rationale |
| -------- | ------ | --------- |
| Skill scope | Single skill, real-world validation only | Static checks are hooks/manual commands, not worth a skill |
| Change analysis | git diff against base branch, user can narrow/expand | Automatic scope from changes, flexible via argument |
| Test plan display | Show plan then immediately start executing | No pause for approval -- user sees what's happening but flow isn't blocked |
| App type detection | Infer from project signals (package.json frameworks, CLI entry points, etc.) | Automatic, no config needed |
| Web app testing | Playwright, install via `npx playwright install` if missing | Most realistic browser testing, standard tool |
| CLI testing | Build binary first, then run real commands | Tests what users actually run, not dev-mode shortcuts |
| Fix strategy | Fix each issue as found, re-run that case, continue. 3 attempts max per case | Prevents cascading failures from one root cause |
| Output format | Same JSON schema as current skill | Pipeline compatibility, simplicity |

## Migration Strategy

This is a full rewrite of SKILL.md. No backwards compatibility needed -- the skill name stays `test`, the JSON output schema stays the same, the pipeline integration is unchanged. The only behavioral change is what the skill actually does when invoked.

## Step by Step Tasks

IMPORTANT: Execute every step in order, top to bottom.

### 1. Rewrite the Frontmatter

- Update `description` to reflect real-world validation focus
- Keep `name: test`
- Update trigger phrases: "test this", "validate the app", "run real tests", "test my changes", "does this work", "try it out", "smoke test", "test the happy path", "test edge cases"
- Update negative triggers: not for lint/typecheck/unit tests (run those directly), not for generating tests (use test-gen agent), not for reviewing against a spec (use review skill)

### 2. Rewrite Purpose

- Single paragraph: analyzes changes, builds a test plan of happy paths and edge cases, then validates by using the app as a real user would -- running CLI commands, driving web UIs with Playwright, hitting API endpoints

### 3. Update Variables

- `argument` -- optional scope directive. Examples: "test the auth flow", "test the new CLI command", "test everything". Default: derive scope from git diff.

### 4. Write Step 1: Analyze Changes and Detect App Type

Two parallel workstreams:

**Change analysis:**
- Run `git diff main...HEAD --name-only` (or appropriate base branch) to get changed files
- Run `git diff main...HEAD` to understand what actually changed
- If user provided a scope argument, use that to filter/expand
- Read the changed files to understand behavioral impact

**App type detection** (check in parallel):
- **CLI app**: look for `main.go`, `main.py`, `src/main.rs`, `[[bin]]` in Cargo.toml, `bin` field in package.json, `click`/`typer`/`argparse`/`cobra`/`kingpin` imports
- **Web app**: look for Next.js/React/Vue/Svelte/Angular in package.json, `app/` or `pages/` directories, HTML templates
- **API server**: look for Express/Fastify/Gin/Echo/FastAPI/Django REST/Rails routes without a frontend
- **Library**: look for exported modules with no entry point, published package config

If multiple types detected (e.g., CLI + API), test both.

### 5. Write Step 2: Build Test Plan

Based on change analysis, generate a checklist with two sections:

**Happy paths** -- the expected usage scenarios affected by the changes:
- For CLI: commands the user would run, with typical arguments
- For web: user flows (navigate to page, fill form, submit, verify result)
- For API: request sequences a client would make
- For library: calling the changed public APIs with normal inputs

**Edge cases** -- boundary conditions, error handling, unusual inputs:
- Invalid/missing arguments for CLI
- Empty states, long inputs, special characters for web
- Malformed requests, auth failures, rate limits for API
- Nil/empty/oversized inputs for library

Display the plan as a markdown checklist. Then immediately begin execution (no pause).

### 6. Write Step 3: Execute Test Plan

For each test case in the plan:

**CLI apps:**
1. Build the binary (e.g., `go build`, `cargo build`, `npm run build`)
2. Run the command with real arguments
3. Check exit code, stdout, stderr against expected behavior
4. Test both success and error paths

**Web apps:**
1. Start the dev server in background (detect start command from justfile/package.json/Makefile)
2. Wait for server to be ready (poll the URL)
3. Use Playwright via a Node.js script to:
   - Navigate to relevant pages
   - Interact with UI elements (click, type, select)
   - Assert visible content and behavior
   - Take screenshots on failure for debugging
4. Stop the dev server when done
5. If Playwright is not installed, run `npx playwright install chromium` first

**API servers:**
1. Start the server in background
2. Wait for it to be ready
3. Make real HTTP requests (curl or equivalent)
4. Check response status, headers, body
5. Stop the server when done

**Libraries:**
1. Write a small test script that imports and calls the changed APIs
2. Run it and check output

Mark each checklist item as pass/fail as execution proceeds.

### 7. Write Step 4: Fix Issues

When a test case fails:
1. Analyze the failure -- read error output, screenshots (for web), exit codes
2. Read the relevant source code
3. Fix the implementation (not the test plan)
4. Re-run that specific test case
5. If it passes, continue to next case
6. If it fails, try again (max 3 attempts per case)
7. After 3 failures, mark as failed and continue

Do NOT fix test infrastructure (Playwright scripts, build configs) more than minimally -- the goal is to find and fix real application bugs.

### 8. Write Step 5: Report

Human-readable summary first:
- What was tested (scope)
- How many passed/failed/fixed
- Key issues found and fixed

Then JSON array on its own line, same schema:
```json
[
  {
    "test_name": "string (descriptive name of the test case)",
    "passed": "boolean",
    "execution_command": "string (command or steps to reproduce)",
    "test_purpose": "string (what user behavior this validates)",
    "error": "optional string",
    "fixed": "optional boolean"
  }
]
```

Failed tests sorted to top. Fixed tests get `"fixed": true`.

### 9. Write Workflow Section

```
1. Analyze -- git diff for changes, detect app type
2. Plan -- build checklist of happy paths and edge cases
3. Execute -- use the app as a real user would
4. Fix -- fix bugs as found, re-validate (3 attempts per case)
5. Report -- human summary + JSON array
```

### 10. Write Cookbook

Cover these scenarios:
- User specifies a narrow scope ("test the login flow")
- User specifies a broad scope ("test everything")
- No argument provided (default to git diff)
- Multiple app types detected (test each type)
- Playwright not installed (install chromium)
- Dev server fails to start
- Build fails before testing can begin
- No meaningful changes detected in git diff
- Web app needs seed data or auth setup
- CLI app needs config files or environment setup
- Test case is flaky (passes sometimes, fails sometimes)
- Change is purely internal refactor with no user-visible behavior change

### 11. Write Validation Section

Before returning:
- Every test case in the plan has been executed or explicitly skipped with reason
- All fixable issues have been fixed (up to 3 attempts)
- JSON is valid and parseable
- Failed tests sorted to top
- Dev servers and background processes are stopped and cleaned up
- execution_command fields are reproducible

### 12. Write Examples

4 examples:
1. CLI app -- new flag added, test happy path and invalid input
2. Web app -- form flow changed, Playwright validates the flow
3. API -- new endpoint, test with curl
4. Mixed -- CLI app with both a command change and an edge case fix, one test fails and gets auto-fixed

## Testing Strategy

Since this is a skill file (markdown), validation is:
- Read the final SKILL.md and verify it follows the skill structure
- Verify frontmatter has exactly `name` and `description`
- Verify all sections are present: Purpose, Variables, Instructions, Workflow, Cookbook, Validation, Examples
- Verify the JSON output schema matches the pipeline's expected input

## Risks & Mitigations

| Risk | Impact | Mitigation |
| ---- | ------ | ---------- |
| Playwright installation fails in some environments | Web app testing blocked | Cookbook recipe: fall back to curl-based checks, report limitation |
| Dev server start is flaky or slow | Tests timeout waiting for server | Generous timeout (30s), poll with backoff, clear error if server never starts |
| Built binary path varies by project | CLI tests run wrong binary | Detect build output from project config, check common paths |
| Git diff scope is too broad (many files changed) | Test plan becomes unwieldy | Group related changes, prioritize user-facing behavior over internal refactors |
| Auto-fix introduces new bugs | Cascading failures | 3-attempt cap per case, re-run only the affected case after fix |

## Validation Commands

Read the file and verify structure:
- `cat ~/.claude/skills/test/SKILL.md` -- verify content
- Check that the pipeline skill can still reference `/test` without changes

## Assumptions

None -- all decisions were made during exploration.
