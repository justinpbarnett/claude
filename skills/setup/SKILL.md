---
name: setup
description: >
  Sets up or updates a project's full Claude Code configuration -- CLAUDE.md,
  project settings, memory files, permissions, plugin overrides, and
  project-specific skills. Auto-detects the tech stack and applies the right
  defaults. Use when onboarding a new project, bootstrapping Claude Code config,
  or updating an existing project's setup. Triggers on "setup this project",
  "configure claude for this project", "bootstrap claude code", "init this
  project", "onboard this repo", "set up claude", "update project config".
  Do NOT use for implementing features (use the implement skill). Do NOT use
  for priming/reading the codebase (use the prime skill). Do NOT use for
  creating skills from scratch (use the skill-builder skill).
---

# Purpose

Sets up or updates a project's complete Claude Code configuration by detecting the tech stack and generating CLAUDE.md, project settings, memory files, plugin overrides, permissions, and safety guards.

## Variables

- `argument` -- Optional. "update" to refresh an existing setup, or "full" to force a complete re-setup. If omitted, auto-detects whether this is a new setup or an update.

## Instructions

### Step 1: Detect Project Type

Scan the project root in parallel to identify the tech stack:

| Signal File | Indicates |
|---|---|
| `go.mod` | Go project |
| `package.json` | Node.js project (check for framework: next, react, vue, svelte, etc.) |
| `pyproject.toml` / `requirements.txt` | Python project |
| `Cargo.toml` | Rust project |
| `Gemfile` | Ruby project |

Also detect:
- **Task runner**: `justfile` (just), `Makefile` (make), `package.json` scripts (npm/pnpm/yarn/bun)
- **Package manager**: `pnpm-lock.yaml` (pnpm), `yarn.lock` (yarn), `bun.lockb` (bun), `package-lock.json` (npm), `go.sum` (go), `uv.lock` (uv)
- **Framework**: Next.js, React, Vue, Svelte, Gin, Echo, Django, Flask, Rails, etc.
- **Database**: Drizzle, Prisma, GORM, SQLAlchemy, ActiveRecord, etc.
- **Testing**: Vitest, Jest, Playwright, pytest, go test, RSpec, etc.
- **Has git remote**: `git remote -v` to determine if GitHub is connected

Record all findings -- they drive every subsequent step.

### Step 2: Check Existing Configuration

Determine setup mode by checking what already exists:

1. `.claude/settings.json` -- project settings
2. `CLAUDE.md` -- project instructions
3. Memory directory at `~/.claude/projects/{project-path}/memory/MEMORY.md`
4. `.claude/skills/` -- project-specific skills

If all exist, this is an **update**. If none exist, this is a **new setup**. If partial, fill in the gaps.

### Step 3: Generate CLAUDE.md

**New setup:** Run the built-in `/init` command first to generate a baseline CLAUDE.md, then enhance it with the structure from `references/claude-md-template.md`. The final CLAUDE.md should include:

- Project name and one-line description
- Tech stack summary
- Key commands (discovered from task runner)
- Architecture overview (top-level directory purposes)
- Testing setup
- Domain-specific rules (ask the user if unclear)

**Update:** Read the existing CLAUDE.md. Check if any sections are outdated:
- Compare key commands against the actual task runner config
- Check if new top-level directories exist that aren't documented
- Verify the stack description matches current dependencies
- Suggest additions but do not remove existing content without asking

### Step 4: Configure Project Settings

Create or update `.claude/settings.json` with project-appropriate overrides.

**Plugin overrides** -- disable plugins not relevant to this stack:

| Stack | Disable |
|---|---|
| Go | `frontend-design`, `typescript-lsp`, `pyright-lsp` |
| Python | `frontend-design`, `typescript-lsp`, `gopls-lsp` |
| Node/TypeScript | `gopls-lsp`, `pyright-lsp` |
| Node + Python | `gopls-lsp` |
| Rust | `frontend-design`, `typescript-lsp`, `pyright-lsp`, `gopls-lsp` |

Only override plugins that are enabled globally. Check `~/.claude/settings.json` for the global plugin list.

**Permissions** -- add project-appropriate tool permissions:

| Stack | Allow |
|---|---|
| Go + make | `go`, `make` |
| Go + just | `go`, `just` |
| Node + pnpm | `pnpm`, `npx` |
| Node + npm | `npm`, `npx` |
| Node + bun | `bun`, `bunx` |
| Python + uv | `uv`, `python` |
| Python + pip | `pip`, `python` |

Always include common safe commands: `mkdir`, `ls`, `cp`, `find`, `mv`, `chmod`, `touch`, `uv`.

**Safety denials** -- always add:
```json
"deny": [
  "Bash(git push --force:*)",
  "Bash(git push -f:*)",
  "Bash(rm -rf:*)"
]
```

**Preserve existing hooks and settings** -- if .claude/settings.json already exists, merge new settings into it. Never overwrite existing hooks or custom configuration.

### Step 5: Create Memory File

Determine the memory directory path:
```bash
# Convert project path to memory path
# /home/user/dev/myproject -> ~/.claude/projects/-home-user-dev-myproject/memory/
```

Create `MEMORY.md` with:
- Project overview (1-2 lines)
- Tech stack quick reference
- Key commands quick reference
- Architecture summary (complement CLAUDE.md, don't duplicate)

Keep under 50 lines. If a memory file already exists, leave it alone -- it contains session-learned insights that shouldn't be overwritten.

### Step 6: Check for Skill Opportunities

Scan the project for patterns that suggest project-specific skills would be valuable:

- **ADW/automation scripts** -- if `adws/` or workflow scripts exist, suggest the `adw-builder` or `prime-adw` skill
- **Database migrations** -- if an ORM with migrations exists (Drizzle, Prisma, Django, etc.), note it for potential `migrate` skill
- **Release process** -- if goreleaser, semantic-release, or similar exists, note it for potential `release` skill
- **E2E testing** -- if Playwright, Cypress, or similar exists with custom setup, note it

Do NOT create these skills automatically. List them as recommendations in the report.

### Step 7: Report

Present a structured summary:

```
## Setup Complete

### Created/Updated
- [x] CLAUDE.md (created / updated N sections)
- [x] .claude/settings.json (plugins: disabled X, Y; permissions: added A, B)
- [x] Memory file at ~/.claude/projects/.../memory/MEMORY.md
- [ ] Project-specific skills (none needed / recommendations below)

### Stack Detected
- Language: X
- Framework: Y
- Package manager: Z
- Task runner: W
- Testing: V

### Skill Recommendations
- [skill idea and why it would help, if any]

### Next Steps
- Run `/prime` to build full codebase context
- [Any project-specific suggestions]
```

## Workflow

1. **Detect** -- Scan project root for stack signals (language, framework, tools)
2. **Check** -- Determine new setup vs update by checking existing config
3. **CLAUDE.md** -- Generate or update project instructions
4. **Settings** -- Configure plugin overrides, permissions, safety guards
5. **Memory** -- Create initial memory file (skip if exists)
6. **Skills** -- Scan for project-specific skill opportunities
7. **Report** -- Summarize everything that was created or changed

## Cookbook

<If: project has no git repository>
<Then: warn the user that Claude Code works best with git. Suggest `git init` before proceeding. Continue with setup regardless.>

<If: CLAUDE.md already exists and is comprehensive>
<Then: do not overwrite. Run in update mode -- check for outdated sections and suggest additions. Show a diff of proposed changes before applying.>

<If: .claude/settings.json already exists with hooks>
<Then: preserve all existing hooks. Only add/update plugin overrides and permissions. Never remove existing hook configuration.>

<If: memory file already exists>
<Then: skip memory creation entirely. Existing memory contains session-learned insights that are more valuable than a fresh template.>

<If: monorepo with multiple languages>
<Then: detect the primary language from the root config. Note sub-packages in the report. Plugin overrides should enable LSPs for all languages present in the repo.>

<If: project uses Docker but no local dev setup>
<Then: note Docker as the primary dev environment. Add `docker` and `docker-compose` to permissions. Check for docker-compose.yml and suggest the `/start` skill.>

<If: unknown or uncommon tech stack>
<Then: set up the basics (CLAUDE.md, memory, safety guards) and skip stack-specific plugin/permission overrides. Ask the user what tools and commands they use.>

<If: user says "update">
<Then: only modify files that need changes. Compare current config against what would be generated fresh. Show a summary of proposed changes before applying. Do not touch files that are already correct.>

<If: project has many dependencies or complex dependency trees>
<Then: use the `deps` agent to audit dependency health, checking for outdated packages, known vulnerabilities, and license issues.>

## Validation

Before reporting completion:
- CLAUDE.md exists and has the required sections (stack, commands, architecture)
- .claude/settings.json is valid JSON
- Memory directory and file exist
- Plugin overrides match the detected stack (no irrelevant LSPs enabled)
- Permissions include the project's task runner and package manager
- Safety denials are present (force push, rm -rf)

## Examples

### Example 1: New Go Project with Makefile

**User says:** "setup this project"

**Detection:** go.mod, Makefile, go test
**Actions:**
1. Generate CLAUDE.md with Go conventions, make targets, architecture
2. Create .claude/settings.json: disable frontend-design, typescript-lsp, pyright-lsp; add go/make permissions
3. Create memory file with project overview
4. Report setup complete

### Example 2: Existing Next.js Project (Update)

**User says:** "/setup update"

**Detection:** package.json (next), pnpm-lock.yaml, justfile, existing CLAUDE.md
**Actions:**
1. Read existing CLAUDE.md, check for outdated commands
2. Update .claude/settings.json: verify gopls-lsp is disabled, pnpm/just in permissions
3. Memory file exists -- skip
4. Report: "1 section updated in CLAUDE.md, settings already correct"

### Example 3: Python FastAPI Project

**User says:** "bootstrap claude code for this project"

**Detection:** pyproject.toml (fastapi), uv.lock, Makefile, pytest
**Actions:**
1. Generate CLAUDE.md with Python conventions, make targets, FastAPI routes
2. Create .claude/settings.json: disable frontend-design, typescript-lsp, gopls-lsp; enable pyright-lsp; add uv/python/make permissions
3. Create memory file
4. Suggest: migrate skill for Alembic migrations
5. Report setup complete
