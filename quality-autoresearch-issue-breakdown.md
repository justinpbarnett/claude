# Issue Breakdown: Quality Autoresearch Pi Package

Source PRD: `quality-autoresearch-prd.md`

This is a proposed vertical-slice breakdown. These are issue drafts, not created GitHub issues yet.

## Proposed slices

### 1. Create installable Pi package with visible noop workflow

**Type:** AFK  
**Blocked by:** None  
**User stories covered:** 1, 2, 47, 48, 49, 50

Build the nested `quality-autoresearch` Pi package with package manifest, extension command, companion skill, and template directory. The command can be a noop/status implementation, but Pi should discover it as an installed local package and expose the workflow entrypoint.

**Acceptance criteria**

- [ ] A nested local Pi package exists under `~/dev/ai/packages/quality-autoresearch/`.
- [ ] The package manifest declares extension and skill resources using Pi package conventions.
- [ ] Pi can load the package and show a `/quality-autoresearch` command.
- [ ] The package includes a quality-autoresearch skill describing the intended setup workflow.
- [ ] The package includes placeholder templates for evaluator/config/autoresearch files.

---

### 2. Add `install.sh pi` and `uninstall.sh pi` support for local package registration

**Type:** AFK  
**Blocked by:** Slice 1  
**User stories covered:** 44, 45, 46, 47

Extend the `~/dev/ai` installer and uninstaller so the local Pi package is added to or removed from Pi's global package list without copying package internals.

**Acceptance criteria**

- [ ] `install.sh pi` adds the local package path to `~/.pi/agent/settings.json` under `packages`.
- [ ] `install.sh all` includes the Pi installation target.
- [ ] Running install repeatedly is idempotent and does not duplicate the package entry.
- [ ] Existing unrelated Pi settings are preserved.
- [ ] `uninstall.sh pi` removes only this package entry and preserves all other settings.
- [ ] Installer behavior can be tested against a temporary settings file or equivalent safe fixture.

---

### 3. Implement setup preflight safety checks and branch/session policy

**Type:** AFK  
**Blocked by:** Slice 1  
**User stories covered:** 11, 12, 13, 14, 15, 16, 17, 25, 26, 27

Make `/quality-autoresearch setup` perform project safety checks before writing files. It should detect current git branch, offer the recommended autoresearch branch when appropriate, detect existing autoresearch files, distinguish quality sessions from unknown sessions, and warn when pi-autoresearch is missing.

**Acceptance criteria**

- [ ] Setup detects whether the current branch follows `autoresearch/*`.
- [ ] Setup recommends `autoresearch/quality-cqp-YYYYMMDD` when not already on an autoresearch branch.
- [ ] Setup asks before creating/switching branches in interactive mode.
- [ ] Existing quality sessions are detected using a profile marker.
- [ ] Existing unknown/non-quality sessions are refused by default.
- [ ] An archive-existing option is represented in the command interface, even if initially conservative.
- [ ] Setup detects likely pi-autoresearch availability and warns with the exact install command when missing.
- [ ] The command does not auto-install pi-autoresearch.

---

### 4. Materialize AI-approved checker plans into quality harness files

**Type:** AFK  
**Blocked by:** Slice 3  
**User stories covered:** 28, 29, 30, 31, 32, 33, 34, 35, 39, 50

Add a validated materialization path where the agent proposes a checker plan, the user approves it, and the extension writes the machine-readable config plus human-readable rationale into standard pi-autoresearch files.

**Acceptance criteria**

- [ ] The extension exposes a `quality_autoresearch_write_config` tool or equivalent materialization mechanism.
- [ ] The checker plan schema supports fixed categories and custom checkers.
- [ ] Invalid checker plans are rejected with actionable validation errors.
- [ ] Materialization writes `.autoresearch/quality/config.json` as the executable truth.
- [ ] Materialization writes project-specific `autoresearch.md` with checker rationale, protected files, metric details, and next steps.
- [ ] Materialization writes root `autoresearch.sh` that invokes the quality evaluator through `uv`.
- [ ] Generated files include the quality profile marker.

---

### 5. Implement generic CQP evaluator core with `uv` inline metadata

**Type:** AFK  
**Blocked by:** Slice 4  
**User stories covered:** 3, 4, 5, 6, 7, 8, 9, 18, 32, 34, 35, 37, 38

Implement the self-contained evaluator script that reads configured checkers, runs commands, aggregates penalties, and emits pi-autoresearch-compatible `METRIC` lines.

**Acceptance criteria**

- [ ] `.autoresearch/quality/evaluate_quality.py` is generated with inline PEP 723 metadata.
- [ ] `autoresearch.sh` runs the evaluator using `uv run --script`.
- [ ] The evaluator reads `.autoresearch/quality/config.json`.
- [ ] The evaluator computes and prints `METRIC cqp=<number>`.
- [ ] The evaluator prints useful secondary metric lines.
- [ ] Generic `metric-lines`, `exit-code`, and `regex-count` parsers work.
- [ ] Custom checker categories contribute to CQP according to configured weights.
- [ ] Evaluator failures are surfaced clearly without silently producing misleading low scores.

---

### 6. Add built-in parser coverage for common quality tools

**Type:** AFK  
**Blocked by:** Slice 5  
**User stories covered:** 18, 19, 20, 21, 36, 37, 38

Expand the evaluator with built-in parsers for common checker outputs while preserving generic fallbacks for uncommon tools.

**Acceptance criteria**

- [ ] Parser support exists for `pytest`.
- [ ] Parser support exists for `ruff`.
- [ ] Parser support exists for `mypy`.
- [ ] Parser support exists for `pyright`.
- [ ] Parser support exists for `eslint`.
- [ ] Parser support exists for `tsc`.
- [ ] Parser support exists for `radon-cc`.
- [ ] Parser support exists for `bandit`.
- [ ] Parser support exists for `interrogate`.
- [ ] Parser behavior is covered by fixture-based tests.

---

### 7. Run baseline and generate baseline-tolerant hard gates

**Type:** AFK  
**Blocked by:** Slice 5; optionally enhanced by Slice 6  
**User stories covered:** 18, 19, 20, 21, 40, 41, 42, 43

After materializing the harness, setup should run a baseline, record results, and generate `autoresearch.checks.sh` only for categories that are safe to hard-gate at baseline.

**Acceptance criteria**

- [ ] Setup runs the evaluator baseline after writing files.
- [ ] Baseline category results are recorded in `.autoresearch/quality/` and summarized in `autoresearch.md`.
- [ ] Passing correctness categories can be emitted as hard checks in `autoresearch.checks.sh`.
- [ ] Baseline-failing categories remain metric-only by default.
- [ ] Strict-checks mode is represented in config/command options.
- [ ] Default setup stops after baseline and prints exact next-step instructions.
- [ ] Start mode can queue or describe a follow-up to begin normal pi-autoresearch looping.

---

### 8. Protect generated quality harness files from accidental or score-gaming edits

**Type:** AFK  
**Blocked by:** Slice 4  
**User stories covered:** 22, 23, 24

Layer protection around evaluator/config files using generated instructions, read-only permissions, and optional extension guard behavior.

**Acceptance criteria**

- [ ] Generated evaluator/config files include clear DO NOT EDIT headers.
- [ ] Generated `autoresearch.md` lists protected files and explains why they are off-limits.
- [ ] Setup applies read-only permissions to protected evaluator/config files where appropriate.
- [ ] The extension can block write/edit attempts under `.autoresearch/quality/` during active quality sessions.
- [ ] An unlock/maintenance path exists for intentional harness updates.
- [ ] Protection behavior does not prevent normal source-code optimization.

---

### 9. End-to-end quality setup smoke test in a fixture project

**Type:** AFK  
**Blocked by:** Slices 2, 3, 4, 5, 7, 8  
**User stories covered:** 1, 2, 10, 39, 41, 44, 45, 46, 48, 49, 50

Add an end-to-end fixture or scripted smoke test that proves the package can be installed, loaded, scaffold a quality session, run baseline, and leave a standard pi-autoresearch-ready project state.

**Acceptance criteria**

- [ ] A fixture project can run the setup path without touching real user settings.
- [ ] The generated root files match pi-autoresearch expectations.
- [ ] The generated hidden quality harness files exist and are referenced by root files.
- [ ] Running the generated `autoresearch.sh` emits `METRIC cqp=...`.
- [ ] The generated `autoresearch.md` contains the profile marker, checker rationale, protected files, and next-step instructions.
- [ ] The smoke test documents how a human can verify the workflow manually in Pi.
