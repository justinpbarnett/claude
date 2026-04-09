# AI Coding Harness Config

Portable configuration for AI coding harnesses. One repo, one source of truth for skills, agents, hooks, and rules that sync across machines and tools.

Supports: [Claude Code](https://docs.anthropic.com/en/docs/claude-code), [ForgeCode](https://forgecode.dev), [OpenCode](https://opencode.ai)

## Install

```bash
git clone git@github.com:justinpbarnett/ai.git ~/dev/ai
~/dev/ai/install.sh all
```

Or pick specific harnesses:

```bash
~/dev/ai/install.sh claude forge
```

Interactive mode (no args):

```bash
~/dev/ai/install.sh
```

## Uninstall

```bash
~/dev/ai/uninstall.sh all        # Remove all
~/dev/ai/uninstall.sh claude     # Remove one
```

Removes symlinks and restores backups if they exist.

## What Gets Installed

| Harness | Target | What's Linked |
|---------|--------|---------------|
| Claude Code | `~/.claude/` | skills, agents, hooks, rules, plugins, CLAUDE.md, settings.json |
| ForgeCode | `~/forge/` | skills, agents, AGENTS.md, .forge.toml |
| OpenCode | `~/.config/opencode/` | skills, agents, AGENTS.md, opencode.json |

## Structure

```
~/dev/ai/
  install.sh                 # Multi-harness installer
  uninstall.sh               # Multi-harness uninstaller
  harnesses.toml             # Harness config reference (what goes where)
  AGENTS.md                  # Shared global rules (all harnesses)
  skills/                    # Shared skills (SKILL.md format, universal)
  agents/                    # Shared agent definitions (markdown + YAML frontmatter)
  hooks/                     # Hook scripts (Claude Code only)
  rules/                     # Rule files (Claude Code only)
  plugins/                   # Plugin registry (Claude Code only)
  harness/                   # Per-harness config files
    claude/
      settings.json          # Claude Code settings (hooks, plugins, model, env)
    forge/
      .forge.toml            # ForgeCode config (limits, sampling, compaction)
    opencode/
      opencode.json          # OpenCode config (provider, default agent)
  runner/                    # Standalone Python CLI for autonomous agent loops
  specs/                     # Feature specs
```

## Shared vs Harness-Specific

### Universal (all harnesses)

- **Skills**: Identical `SKILL.md` format. Works everywhere with no conversion.
- **AGENTS.md**: Shared rules file. Claude Code reads it as `CLAUDE.md` (symlinked), Forge and OpenCode read `AGENTS.md` natively.

### Shared with caveats

- **Agents**: All three use markdown with YAML frontmatter, but the keys differ. The shared agents use Claude Code format (`name`, `tools`, `model`, `maxTurns`). Forge and OpenCode may need harness-specific overrides for advanced fields (provider, temperature, tool_supported).

### Claude Code only

- **Hooks**: Pre/PostToolUse lifecycle hooks. Forge and OpenCode have no hook system.
- **Rules**: Loaded as `.md` files into Claude Code's context. Forge and OpenCode put equivalent rules in AGENTS.md.
- **Plugins**: Anthropic marketplace plugins. Forge and OpenCode don't have a plugin marketplace.

## Skills (39)

| Category | Skills |
|----------|--------|
| Development | pipeline, build, make, fix, start, branch, cp, promote |
| Planning | decompose, autoplan, plan-ceo-review, plan-design-review, plan-eng-review |
| Testing | test, deep-audit, qa, investigate |
| Agents | team, codex |
| Design | design-shotgun, design-html |
| Docs | document, document-release, download-docs |
| Safety | guard, freeze, unfreeze, careful |
| Git | prime, retro |
| GitNexus | gitnexus-guide, gitnexus-exploring, gitnexus-debugging, gitnexus-impact-analysis, gitnexus-refactoring, gitnexus-pr-review, gitnexus-cli |
| Platform | unity-mcp-skill, omarchy |

## Agents (11)

| Agent | Model | Purpose |
|-------|-------|---------|
| research | sonnet | Deep codebase/API investigation (read-only) |
| test-gen | sonnet | Generates tests matching project conventions |
| security | sonnet | OWASP top 10 scanning (read-only) |
| migrate | sonnet | Database migration generation and safety checks |
| perf-profile | sonnet | Hot path analysis and optimization (read-only) |
| generator | sonnet | Sprint implementer for build/make/fix harnesses |
| evaluator | sonnet | Sprint verifier for build/make/fix harnesses |
| planner | sonnet | Spec to sprint plan decomposition |
| deps | haiku | Dependency audit for updates and CVEs (read-only) |
| changelog | haiku | Release notes from git history (read-only) |
| api-docs | haiku | API reference from route handlers (read-only) |

## Hooks (10, Claude Code only)

| Event | Hook | Purpose |
|-------|------|---------|
| PreToolUse | validate-commit.sh | Conventional commits, no AI mentions |
| PreToolUse | gitnexus-hook.cjs | Graph context augmentation |
| PostToolUse | auto-format.sh | gofmt/ruff/prettier |
| PostToolUse | check-emdash.sh | Catch emdash characters |
| PostToolUse | post-edit-lint.sh | go vet/ruff/eslint |
| PostToolUse | track-commits.sh | Log commits to project memory |
| PostToolUse | post-commit-check.sh | Run test suite after commits |
| PostToolUse | gitnexus-hook.cjs | Index staleness check |
| TeammateIdle | teammate-idle-lint.sh | Lint changed files |
| TaskCompleted | track-tasks.sh | Log agent task completions |

## Rules (3, Claude Code only)

| Rule | Enforces |
|------|----------|
| style.md | No emdashes, prose style, words to avoid |
| commits.md | Conventional format, no AI mentions, atomic commits |
| workflow.md | Task runner detection, build validation |

## Adding a New Harness

1. Add a section to `harnesses.toml` documenting the harness's config expectations
2. Create `harness/<name>/` with its config files
3. Add `install_<name>` and `uninstall_<name>` functions to the scripts
4. Add the name to `ALL_HARNESSES` array in both scripts

## Updating

Changes to any file in this repo are live immediately via symlinks. Commit and push to sync across machines.

```bash
cd ~/dev/ai
git add -A && git commit -m "feat: add new skill"
git push
```

On another machine:

```bash
cd ~/dev/ai && git pull
```
