# PRD: Quality Autoresearch Pi Package

## Problem Statement

The user wants an easy, repeatable way to set up a pi-autoresearch loop that improves codebase maintainability using a single weighted quality metric. Today, setting up pi-autoresearch for code quality requires manually choosing checkers, writing evaluator scripts, creating the correct `autoresearch.*` files, protecting the harness from accidental edits, and remembering pi-autoresearch best practices. This is slow, error-prone, and hard to copy across computers.

The user also wants this solution to coexist with other autoresearch initiatives in the same projects, such as P&L optimization in `~/dev/arbiter`, without inventing a competing initiative-management system. The solution should stay close to pi-autoresearch's native model: one active autoresearch session per branch and working directory, with standard root `autoresearch.*` files.

## Solution

Build a nested local Pi package stored in `~/dev/ai` that provides a quality-autoresearch setup workflow. The package will include a Pi extension command, a companion skill, and reusable templates. The first profile will scaffold a standard pi-autoresearch session for code quality, using a composite Code Quality Penalty metric named `cqp`, where lower is better.

The package will be installed through the existing `~/dev/ai/install.sh` workflow by adding its local package path to Pi's global `settings.json` package list. It will not copy package internals into global extension or skill directories.

The setup workflow should preserve pi-autoresearch conventions:

- Multiple initiatives are represented by separate `autoresearch/<goal>-<date>` git branches.
- The active session uses root-level `autoresearch.md`, `autoresearch.sh`, `autoresearch.checks.sh`, `autoresearch.config.json`, and `autoresearch.jsonl`.
- Quality-specific evaluator internals live under `.autoresearch/quality/`.
- Existing non-quality autoresearch sessions are not overwritten.

The evaluator will be a self-contained Python script run with `uv` using inline PEP 723 metadata. It will read a machine-readable checker configuration, run configured commands, parse outputs using built-in or generic parsers, and emit `METRIC cqp=<number>` plus secondary metric lines.

The checker plan is AI-assisted: the agent inspects the project, proposes appropriate checks, asks the user to approve tools/installations, then calls an extension tool to materialize and validate the config.

## User Stories

1. As a developer, I want one command to scaffold quality autoresearch, so that I do not have to remember the pi-autoresearch setup steps.
2. As a developer, I want the setup to follow pi-autoresearch conventions, so that I can use existing pi-autoresearch tools and best practices unchanged.
3. As a developer, I want code quality optimization to use a single scalar metric, so that the autoresearch loop has an objective keep/discard signal.
4. As a developer, I want the primary metric to be named `cqp`, so that it is concise and easy to read in experiment logs.
5. As a developer, I want lower `cqp` to be better, so that quality improvements map naturally to penalty reduction.
6. As a developer, I want the evaluator to print secondary metrics, so that I can understand what changed beyond the primary score.
7. As a developer, I want the evaluator to run through `uv`, so that Python dependencies and execution are reproducible.
8. As a developer, I want the evaluator to use inline PEP 723 metadata, so that the harness is self-contained and copyable.
9. As a developer, I want quality harness internals stored under `.autoresearch/quality/`, so that root-level pi-autoresearch files stay clean.
10. As a developer, I want root-level `autoresearch.md` and `autoresearch.sh`, so that pi-autoresearch works normally.
11. As a developer, I want the setup command to ask before creating a branch, so that it does not surprise me by switching branches.
12. As a developer, I want the recommended branch name to follow `autoresearch/quality-cqp-YYYYMMDD`, so that quality experiments are clearly separated.
13. As a developer, I want other initiatives like P&L optimization to live on separate autoresearch branches, so that metrics and logs do not mix.
14. As a developer, I want setup to refuse to overwrite unrelated existing autoresearch sessions, so that my P&L or latency experiments are safe.
15. As a developer, I want quality sessions marked with a profile marker, so that the setup can distinguish resume/update from overwrite.
16. As a developer, I want setup to resume or update existing quality sessions, so that I can iterate on the same quality initiative.
17. As a developer, I want an escape hatch to archive existing autoresearch files, so that I can recover from messy project states intentionally.
18. As a developer, I want correctness signals included in `cqp`, so that the optimizer prioritizes tests, types, and security.
19. As a developer, I want baseline-passing correctness categories enforced as hard checks, so that improved code is not kept if it breaks working guarantees.
20. As a developer, I want baseline-failing categories treated as metric-only by default, so that legacy projects can still improve incrementally.
21. As a developer, I want optional strict checks, so that greenfield projects can require zero failures.
22. As a developer, I want protected evaluator files, so that the agent cannot improve the score by weakening the harness.
23. As a developer, I want protection through instructions, read-only permissions, and optional extension guards, so that accidental edits are unlikely.
24. As a developer, I want an unlock path for harness maintenance, so that I can intentionally update evaluator logic.
25. As a developer, I want the setup to detect whether pi-autoresearch is installed, so that I know whether the loop can run.
26. As a developer, I do not want this package to auto-install pi-autoresearch, so that third-party package installation remains explicit.
27. As a developer, I want a clear warning with the exact pi-autoresearch install command, so that missing dependencies are easy to fix.
28. As a developer, I want the agent to inspect my repo and propose checkers, so that the setup adapts to different languages and project conventions.
29. As a developer, I want to approve tool choices and installations, so that setup does not mutate my project unexpectedly.
30. As a developer, I want the default setup to avoid installing missing tools, so that it is safe to run in any project.
31. As a developer, I want an explicit install-tools mode later, so that I can opt into automated dev dependency installation.
32. As a developer, I want checker decisions stored in config, so that the evaluator is reproducible.
33. As a developer, I want checker rationale stored in `autoresearch.md`, so that future agents understand why tools were chosen.
34. As a developer, I want fixed recommended checker categories, so that CQP remains interpretable.
35. As a developer, I want custom checker support, so that project-specific quality or architecture rules can contribute to CQP.
36. As a developer, I want built-in parsers for common tools, so that setup works well for typical projects.
37. As a developer, I want generic parser fallbacks, so that uncommon tools can still be integrated.
38. As a developer, I want parser support for metric lines, so that custom scripts can emit structured findings directly.
39. As a developer, I want `autoresearch.md` generated project-specifically, so that a fresh agent can resume without conversation context.
40. As a developer, I want baseline results captured in the handoff doc, so that the agent knows what categories are currently most valuable.
41. As a developer, I want setup to run a baseline before stopping, so that I know the harness works.
42. As a developer, I want default setup to stop after preparation, so that autonomous overnight work does not start accidentally.
43. As a developer, I want an explicit `--start` option later, so that I can opt into starting the loop immediately.
44. As a developer, I want `~/dev/ai/install.sh pi` to install the package, so that setup across computers is one command.
45. As a developer, I want `~/dev/ai/install.sh all` to include Pi package installation, so that my normal bootstrap flow picks it up.
46. As a developer, I want `~/dev/ai/uninstall.sh pi` to remove the package from Pi settings, so that uninstall is reversible.
47. As a developer, I want the package stored as a nested Pi package, so that `~/dev/ai` does not expose unrelated files as Pi resources.
48. As a developer, I want the package to include a skill, so that agents have durable instructions for quality autoresearch.
49. As a developer, I want the package to include an extension command, so that setup can be interactive, validated, and repeatable.
50. As a developer, I want the package to include templates, so that generated files are consistent across projects.

## Implementation Decisions

- Build a nested local Pi package rather than making all of `~/dev/ai` a Pi package.
- The package exposes a profile-specific quality setup command rather than a general multi-initiative manager.
- Multiple autoresearch initiatives are handled using pi-autoresearch's native branch/session pattern.
- The first supported profile is quality CQP.
- The setup command creates or updates standard pi-autoresearch root files.
- Quality evaluator internals live in a dedicated hidden quality harness directory.
- Existing session detection uses a quality profile marker.
- Existing non-quality sessions are refused by default.
- The primary metric is `cqp`, lower is better.
- The evaluator is a config-driven Python script run through `uv`.
- The evaluator uses inline PEP 723 metadata instead of a separate harness project file.
- Checker plans are generated by the agent and materialized by extension validation.
- The checker config is machine-readable and authoritative.
- `autoresearch.md` records human-readable rationale and handoff context.
- The checker schema includes fixed recommended categories plus custom checkers.
- Parser support includes common built-ins and generic fallbacks.
- Correctness signals participate in the metric and can also become hard gates.
- Hard gates are baseline-tolerant by default.
- The package detects but does not install pi-autoresearch.
- The `~/dev/ai` installer modifies Pi's package list in settings instead of symlinking package internals.
- The extension can optionally guard protected harness files during active quality sessions.

## Testing Decisions

Good tests should verify observable behavior and generated artifacts, not incidental implementation details. The important behaviors are installer idempotency, package discovery shape, setup safety, config validation, evaluator scoring, parser output handling, and protection of existing autoresearch sessions.

Modules or areas to test:

- Installer integration for adding and removing the local package path from Pi settings.
- Idempotent install/uninstall behavior.
- Existing settings preservation when adding the package path.
- Extension command behavior for branch detection and user confirmation boundaries.
- Existing autoresearch session detection for quality vs unknown profiles.
- Checker plan schema validation.
- Template materialization into the expected root and hidden harness files.
- Evaluator parser behavior for built-in parsers and generic fallbacks.
- CQP aggregation from checker findings and weights.
- Baseline-tolerant hard-gate generation.
- Protection behavior for evaluator/config files.

Testing should favor small, isolated fixtures over real user projects. The evaluator should be testable as a deep module with fixture command outputs. Installer tests can use temporary settings files rather than mutating real Pi settings.

## Out of Scope

- Building a general autoresearch initiative manager.
- Replacing pi-autoresearch's keep/revert loop.
- Auto-installing pi-autoresearch.
- Full language-specific checker coverage for every ecosystem in v1.
- Automatically installing project quality tools by default.
- Submitting or managing GitHub issues as part of this implementation.
- Optimizing non-quality initiatives such as P&L in this first package profile.
- Publishing the package to npm or a public package gallery.

## Further Notes

The v1 implementation can start with package skeleton, installer integration, skill/spec, and template placeholders. The full evaluator/parser system can be implemented incrementally after the structure is in place.

The design goal is to make the easy path correct while preserving user control. The package should reduce setup friction without hiding pi-autoresearch's core model.