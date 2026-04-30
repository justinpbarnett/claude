---
name: quality-autoresearch
description: Set up a quality-focused pi-autoresearch session that minimizes Code Quality Penalty (cqp). Use when the user asks to run autoresearch for maintainability, code quality, lint/type/test cleanup, or CQP.
---

# Quality Autoresearch

Set up a standard pi-autoresearch session for code quality improvement. Stay close to pi-autoresearch conventions: one initiative per branch, root `autoresearch.*` files, `cqp` as the primary metric, lower is better.

## Workflow

1. Ensure this is the intended initiative branch, preferably `autoresearch/quality-cqp-YYYYMMDD`.
2. If root `autoresearch.*` files already exist, verify they are marked `<!-- autoresearch-profile: quality-cqp -->` before updating them. Do not overwrite unknown/non-quality sessions.
3. Inspect the project and propose a checker plan. Prefer existing project commands. Do not install missing tools unless the user explicitly approves.
4. Ask the user to approve the checker plan.
5. Call `quality_autoresearch_write_config` with the approved plan.
6. Run `./autoresearch.sh` to confirm it emits `METRIC cqp=<number>`.
7. Start the normal pi-autoresearch loop only if the user asked for `--start` or explicitly confirms.

## Checker plan guidance

Use fixed categories when possible:

- `correctness`
- `typing`
- `security`
- `lint`
- `complexity`
- `size`
- `duplication`
- `docs`
- `debt`
- `custom`

Supported parsers in the template evaluator:

- `metric-lines`
- `exit-code`
- `regex-count`

Future/built-in parser names reserved for richer support:

- `pytest`
- `ruff`
- `mypy`
- `pyright`
- `eslint`
- `tsc`
- `radon-cc`
- `bandit`
- `interrogate`

## Rules

- The primary metric is `cqp`, lower is better.
- Include correctness in CQP so the optimizer sees a gradient.
- Hard gates should be baseline-tolerant: only gate categories that are already passing unless strict mode is requested.
- Generated harness files under `.autoresearch/quality/` are protected. Do not edit them during experiments unless the user intentionally unlocks maintenance mode.
- Do not delete, skip, or weaken tests to improve CQP.
