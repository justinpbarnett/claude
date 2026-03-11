---
name: test
description: >
  Analyzes recent changes, builds a test plan of happy paths and edge cases,
  then validates by using the application as a real user would -- running CLI
  commands, driving web UIs with Playwright, hitting API endpoints with real
  requests. Fixes bugs found during testing and reports results in JSON.
  Use when a user wants to test the app, validate changes, smoke test,
  try it out, or check if things work. Triggers on "test this", "validate
  the app", "run real tests", "test my changes", "does this work", "try it
  out", "smoke test", "test the happy path", "test edge cases". Do NOT use
  for lint/typecheck/unit tests (run those directly). Do NOT use for
  generating test files (use the test-gen agent). Do NOT use for reviewing
  against a spec (use the review skill). Do NOT use for starting the dev
  server (use the start skill).
---

## Ground Rules

**Test like a human. No shortcuts.**

You are a human QA tester sitting at the keyboard. Run the exact same commands a user would type. Click the exact same buttons a user would click. Use the exact same config files, credentials, and data that already exist in the local environment.

**NEVER create mocks, stubs, fakes, or test doubles.** No mock HTTP servers. No fake API responses. No stubbed services. No intercepted network calls. If the app talks to Jira, test against real Jira. If it reads from a database, use the real database. If it needs an API key, find the one already configured on this machine.

**NEVER write test scripts, test harnesses, or wrapper programs** that import application code and call it programmatically. That is unit testing, not behavioral testing. The only exception is Playwright scripts for web UIs, because that is how you simulate a human using a browser.

**Use real data from the local environment.** Before testing, discover what is already available:
- Config files (check `~/.config/`, `~/.local/share/`, `.env`, project config dirs)
- Credentials and API keys already stored on the machine
- Existing databases, user accounts, and content
- The app's own CLI or API to create any additional test data needed

If credentials are missing or expired, report that as a finding -- do not work around it with fakes.

## Instructions

### Step 1: Analyze Changes and Detect App Type

The optional `argument` narrows or expands scope (e.g., "test the auth flow", "test everything"). Default: derive scope from git diff.

Run two parallel workstreams:

**Change analysis:**
- Run `git diff main...HEAD` to get changed files and understand what changed
- If the user provided a scope argument, use that to filter or expand
- Read changed files relevant to the detected app type to understand behavioral impact

**App type detection** (check in parallel):
- **CLI app**: look for `main.go`, `main.py`, `src/main.rs`, `[[bin]]` in Cargo.toml, `bin` field in package.json, `click`/`typer`/`argparse`/`cobra`/`kingpin` imports
- **Web app**: look for Next.js/React/Vue/Svelte/Angular in package.json, `app/` or `pages/` directories, HTML templates
- **API server**: look for Express/Fastify/Gin/Echo/FastAPI/Django REST/Rails routes without a frontend
- **Library**: look for exported modules with no entry point, published package config

If multiple types detected (e.g., CLI + API), test both.

### Step 2: Build Test Plan

Based on the change analysis, generate a checklist with two sections:

**Happy paths** -- expected usage scenarios affected by the changes:
- For CLI: commands the user would run, with typical arguments
- For web: user flows (navigate to page, fill form, submit, verify result)
- For API: request sequences a client would make
- For library: calling the changed public APIs with normal inputs

**Edge cases** -- boundary conditions, error handling, unusual inputs:
- Invalid/missing arguments for CLI
- Empty states, long inputs, special characters for web
- Malformed requests, auth failures for API
- Nil/empty/oversized inputs for library

Display the plan as a markdown checklist. Then immediately begin execution (no pause).

### Step 3: Discover Local Environment

Before executing any tests, find the real config, credentials, and data already on this machine:

1. Check for config files: `~/.config/<app>/`, `~/.local/share/<app>/`, `.env`, `.env.local`, project-local config dirs
2. Check for credentials: API keys, tokens, auth files referenced by the app's config
3. Check for databases: SQLite files, running Postgres/MySQL, Redis instances
4. Check for running services the app depends on (use `ss -tlnp` or `systemctl`)
5. Read the app's config-loading code to know exactly where it looks for settings

Use what you find. If something is missing or expired, note it as a test finding.

### Step 4: Execute Test Plan

Run every test exactly as a human would -- same commands, same inputs, same environment. No mocks. No fakes. No programmatic shortcuts.

**CLI apps:**
1. Build the binary (e.g., `go build`, `cargo build`, `npm run build`)
2. Run the exact command a user would type, with real arguments and real environment variables
3. Pipe real input when the app reads from stdin
4. Check exit code, stdout, stderr against expected behavior
5. Test both success and error paths

**Web apps:**
1. Start the dev server in background (detect start command from justfile/package.json/Makefile)
2. Wait for server to be ready (poll the URL)
3. Use Playwright via a Node.js script to simulate a real user:
   - Navigate to pages the same way a user would
   - Click buttons, type into fields, select options
   - Verify what appears on screen
   - Take screenshots on failure for debugging
4. Stop the dev server when done
5. If Playwright is not installed, run `npx playwright install chromium` first

**API servers:**
1. Start the server in background
2. Wait for it to be ready
3. Make real HTTP requests with curl -- the same requests a client would make
4. Use real auth tokens from the local environment
5. Check response status, headers, body
6. Stop the server when done

**Libraries:**
1. Write a minimal script that calls the public API the same way a consumer would
2. Run it and check output

**Test data management:** If a test requires data (users, records, content), create it using the app's own CLI or API -- the same way a real user would. Track everything created so cleanup is guaranteed even if a test fails. Fall back to direct DB queries only if the app provides no other way.

Mark each checklist item as pass/fail as execution proceeds.

### Step 5: Fix Issues

When a test case fails:
1. Analyze the failure -- read error output, screenshots (for web), exit codes
2. Read the relevant source code
3. Fix the implementation (not the test plan)
4. Re-run that specific test case
5. If it passes, continue to next case
6. If it fails, try again (max 3 attempts per case)
7. After 3 failures, mark as failed and continue

Prioritize fixing application bugs over fixing test infrastructure (Playwright scripts, build configs).

### Step 6: Report

Output a **human-readable summary** (scope, pass/fail/fixed counts, key issues), then a **JSON array** on its own line (valid for `JSON.parse()`):

```json
[
  {
    "test_name": "string (descriptive name of the test case)",
    "passed": boolean,
    "execution_command": "string (command or steps to reproduce)",
    "test_purpose": "string (what user behavior this validates)",
    "error": "optional string",
    "fixed": "optional boolean"
  }
]
```

Failed tests sorted to top. Fixed tests get `"fixed": true`.

## Cookbook

<If: user provides a scope argument>
<Then: focus the test plan on that scope. "test everything" expands beyond git diff to all major flows. A narrow scope (e.g., "test the login flow") skips unrelated changes. No argument means derive from git diff.>

<If: multiple app types detected (e.g., CLI + API)>
<Then: build separate test plan sections for each type. Execute each with the appropriate strategy.>

<If: Playwright is not installed>
<Then: run `npx playwright install chromium` before web app tests. If installation fails, fall back to curl-based checks and report the limitation.>

<If: build or dev server fails to start>
<Then: report the failure with error output. Attempt to fix (counts toward 3-attempt limit). If unfixable, stop and report -- no tests can proceed.>

<If: no meaningful changes detected in git diff>
<Then: if user provided a scope argument, use that. Otherwise, report that no changes were detected and ask the user what they want to test.>

<If: app connects to external services (APIs, databases, SaaS)>
<Then: find the real credentials and config already on this machine. Read the app's config-loading code to know where it looks. Use the real services. NEVER create mock servers, fake responses, or stub anything. If a credential is missing or expired, report it as a finding.>

<If: you are tempted to create a mock, stub, fake server, or test harness>
<Then: STOP. You are doing it wrong. Go back to Step 3 and find the real config. Test against real services. If a service is unreachable, report that as a finding -- do not fake it.>

<If: app needs setup (seed data, auth, config files)>
<Then: check for seed scripts, .env.example, setup documentation. Prepare the environment before testing. Use the app's own CLI or API to create test data -- never insert data by writing code that imports app internals.>

<If: test case is flaky (passes sometimes, fails sometimes)>
<Then: run 3 times. Pass on 2/3, fail on 1/3 or fewer passes.>

<If: multiple app types detected (e.g., CLI + API + Web) and changes span all types>
<Then: consider spawning teammates to test each app type in parallel. One teammate per app type, each following the appropriate test strategy (CLI commands, Playwright, curl). Merge results into a single JSON array. Teammates use sonnet. Only do this when there are 3+ distinct app types to test -- for 1-2 types, sequential execution is simpler.>

<If: change is purely internal refactor with no user-visible behavior change>
<Then: identify the closest user-visible behavior and test that. If none, suggest running unit tests directly instead.>

## Validation

Before returning the report:
- Every test case in the plan has been executed or explicitly skipped with reason
- All fixable issues have been fixed (up to 3 attempts per case)
- JSON is valid and parseable
- Failed tests sorted to top
- Dev servers and background processes are stopped and cleaned up
- All test data (DB records, uploaded files, temp accounts) has been removed -- the app state should match pre-test state
- `execution_command` fields are reproducible from the project root

## Examples

### Example 1: CLI app -- new flag added

**Scope:** new `--verbose` flag on `build` command. **App type:** CLI (Go).
**Plan:** `./myapp build` (default), `./myapp build --verbose` (new flag), `./myapp build --verbose --invalid` (bad flag), `./myapp build --verbose ""` (empty arg).
**Actions:** `go build -o myapp .`, run each case, all pass.

```json
[
  {"test_name": "build default behavior", "passed": true, "execution_command": "./myapp build", "test_purpose": "Verify default build still works without new flag"},
  {"test_name": "build with --verbose", "passed": true, "execution_command": "./myapp build --verbose", "test_purpose": "Verify new verbose flag produces detailed output"},
  {"test_name": "unknown flag rejected", "passed": true, "execution_command": "./myapp build --verbose --invalid", "test_purpose": "Verify unknown flags produce a clear error"},
  {"test_name": "empty argument handled", "passed": true, "execution_command": "./myapp build --verbose \"\"", "test_purpose": "Verify empty string argument doesn't crash"}
]
```

### Example 2: Web app -- form flow with auto-fix

**Scope:** signup form component changed. **App type:** Web (Next.js).
**Plan:** fill and submit form (happy path), submit empty (validation), invalid email (validation).
**Actions:** `npm run dev &`, wait for ready, Playwright tests. Empty-field test fails -- form submits without validation. Fix: add required attributes. Re-run passes. Kill server.

```json
[
  {"test_name": "empty field validation", "passed": true, "execution_command": "Navigate to /signup, click Submit without filling fields", "test_purpose": "Verify form shows validation errors for empty fields", "fixed": true},
  {"test_name": "signup happy path", "passed": true, "execution_command": "Navigate to /signup, fill name/email/password, click Submit", "test_purpose": "Verify a new user can sign up successfully"},
  {"test_name": "invalid email validation", "passed": true, "execution_command": "Navigate to /signup, enter 'notanemail' in email field, click Submit", "test_purpose": "Verify form rejects invalid email format"}
]
```
