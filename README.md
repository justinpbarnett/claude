# Claude Code Config

Portable configuration for [Claude Code](https://docs.anthropic.com/en/docs/claude-code) -- skills, agents, hooks, and rules that sync across machines.

## Install

```bash
git clone git@github.com:justinpbarnett/claude.git ~/dev/claude
~/dev/claude/install.sh
```

The install script creates symlinks from `~/.claude/` to this repo. Existing files are backed up with a `.bak.*` suffix before being replaced.

## Uninstall

```bash
~/dev/claude/uninstall.sh
```

Removes symlinks and restores backups if they exist.

## What's Included

### Skills (14)

| Skill | Purpose |
|-------|---------|
| `pipeline` | End-to-end autonomous workflow: branch, decompose, implement (parallel), test, review, commit, PR |
| `setup` | Bootstraps a project's full config (CLAUDE.md, settings, memory, permissions) |
| `spec` | Creates structured implementation specs by commit type |
| `implement` | Executes specs with drift detection and agent delegation |
| `review` | Reviews against specs and auto-fixes blocker/tech_debt issues |
| `test` | Runs validation suite, fixes failures, reports results |
| `commit` | Atomic conventional commits grouped by logical concern |
| `pr` | Creates GitHub PRs with conventional titles and structured bodies |
| `branch` | Creates feature branches from spec filenames |
| `prime` | Scans project structure and builds codebase context |
| `start` | Discovers and runs the dev server |
| `document` | Generates feature docs from git diffs |
| `decompose` | Breaks large specs into focused sub-tasks |
| `skill-builder` | Creates, converts, or improves skills |

### Agents (8)

| Agent | Model | Purpose |
|-------|-------|---------|
| `research` | sonnet | Deep codebase/API investigation (read-only) |
| `test-gen` | sonnet | Generates tests matching project conventions |
| `security` | sonnet | OWASP top 10 scanning (read-only) |
| `migrate` | sonnet | Database migration generation and safety checks |
| `perf-profile` | sonnet | Hot path analysis and optimization (read-only) |
| `deps` | haiku | Dependency audit for updates and CVEs (read-only) |
| `changelog` | haiku | Release notes from git history (read-only) |
| `api-docs` | haiku | API reference from route handlers (read-only) |

### Hooks (5)

| Hook | Event | Purpose |
|------|-------|---------|
| `validate-commit.sh` | PreToolUse (Bash) | Enforces conventional commits, blocks AI mentions |
| `auto-format.sh` | PostToolUse (Write/Edit) | gofmt for Go, prettier for Node |
| `check-emdash.sh` | PostToolUse (Write/Edit) | Catches emdash characters in user-facing files |
| `post-edit-lint.sh` | PostToolUse (Write/Edit) | go vet or eslint after edits |
| `track-commits.sh` | PostToolUse (Bash) | Logs commits to project memory |

### Rules (3)

| Rule | Enforces |
|------|----------|
| `style.md` | No emdashes, no unnecessary annotations, self-documenting code |
| `commits.md` | Conventional format, no AI mentions, atomic commits |
| `workflow.md` | Task runner detection, build validation, thoroughness |

## Workflow

The core development loop:

```
prime -> spec -> branch -> decompose -> implement (parallel) -> test -> review -> simplify -> commit -> PR
```

The `/pipeline` skill chains this entire loop into a single command:

```
/pipeline specs/feat-user-auth.md
```

## Updating

Edit files directly in this repo -- changes are live immediately via symlinks. Commit and push to sync across machines.

```bash
cd ~/dev/claude
git add -A && git commit -m "feat: add new skill"
git push
```

On another machine:

```bash
cd ~/dev/claude && git pull
```
