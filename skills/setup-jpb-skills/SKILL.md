---
name: setup-jpb-skills
description: Syncs JPB's repo-managed Matt Pocock skills (preserving local ones), then (for a target project) scaffolds issue-tracker / triage-label / domain-doc configuration so JPB's engineering skills know where work is tracked and how the repo is organized. Run in a project before first use of `to-issues`, `to-prd`, `triage`, `diagnose`, `tdd`, `improve-codebase-architecture`, or `zoom-out`.
disable-model-invocation: true
---

# Setup JPB Skills

Optionally sync JPB's repo-managed Matt Pocock skills (preserving local custom ones), then for a *target project repo* scaffold the configuration that JPB's engineering skills expect:

- **Issue tracker** — where issues live (GitHub, GitLab, local .scratch/ markdown, or other).
- **Triage labels** — mapping for the five canonical roles used by the `triage` skill.
- **Domain docs** — whether the repo uses a single root CONTEXT.md + docs/adr/ or a multi-context layout via CONTEXT-MAP.md.

This skill no longer assumes or creates AGENTS.md/CLAUDE.md "Agent skills" blocks or a docs/agents/ directory in the JPB harness source repo itself (~/dev/ai). It can still be used to configure *other* client projects if desired. This is a prompt-driven skill. Explore, present findings, confirm, then write.

## Process

### 0. Sync Matt Pocock skills

Before configuring the target repo, check whether the local JPB skill repo is available at `~/dev/ai`. If it is, offer to sync Matt Pocock's upstream skills.

Explain:

> JPB's skill repo keeps selected Matt Pocock engineering/productivity skills as repo-managed copies. Syncing means: pull Matt's latest `main`, update text for installed upstream-synced skills, remove any installed upstream skill that Matt has moved to `deprecated/`, and ask before adding upstream skills that are available but not installed yet. Local JPB skills (`contribute`, `deep-audit`, `find-skills`, `humanize`, `setup-jpb-skills`) are preserved.

Ask the user whether to run the sync. If yes:

1. Clone or refresh Matt's repo in a temp directory:

   ```bash
   rm -rf /tmp/matt-skills
   git clone --depth 1 https://github.com/mattpocock/skills.git /tmp/matt-skills
   ```

2. Discover upstream sets:

   ```bash
   find /tmp/matt-skills/skills/engineering /tmp/matt-skills/skills/productivity -mindepth 1 -maxdepth 1 -type d | xargs -I{} basename {} | sort
   find /tmp/matt-skills/skills/deprecated -mindepth 1 -maxdepth 1 -type d 2>/dev/null | xargs -I{} basename {} | sort
   find ~/dev/ai/skills -mindepth 1 -maxdepth 1 -type d | xargs -I{} basename {} | sort
   ```

3. Preserve these local JPB skills regardless of upstream state:

   ```text
   contribute
   deep-audit
   find-skills
   humanize
   setup-jpb-skills
   ```

4. For installed skills that are present in Matt's `engineering/` or `productivity/`, replace the local copy with the upstream directory, except do **not** replace preserved local JPB skills (`contribute`, `deep-audit`, `find-skills`, `humanize`, `setup-jpb-skills`) or replace `setup-jpb-skills` with upstream `setup-matt-pocock-skills`.

5. For installed skills that are present in Matt's `deprecated/`, remove them from `~/dev/ai/skills` (unless they are one of the preserved local JPB skills). Re-run `./install.sh` afterward so harnesses drop the deleted skill.

6. For upstream engineering/productivity skills that are not currently installed, show the list to the user and ask which to add. Do not add all automatically.

7. After changes, verify upstream-synced skills are exact copies with `diff -qr`, then run `./install.sh all` (or the relevant harnesses) so the updated skill set is symlinked into Claude, Pi, Codex, etc.

8. Present a concise summary: updated, removed-as-deprecated, newly-added, skipped, and preserved-local.

If the user declines sync, continue to per-repo configuration.

### 1. Explore

Look at the current repo to understand its starting state. Read whatever exists; don't assume:

- `git remote -v` and `.git/config` — is this a GitHub repo? Which one?
- `CONTEXT.md` and `CONTEXT-MAP.md` at the repo root (note: the JPB harness source repo ~/dev/ai itself no longer uses AGENTS.md, CLAUDE.md, or docs/agents/)
- `docs/adr/` and any `src/*/docs/adr/` directories
- `.scratch/` — sign that a local-markdown issue tracker convention is already in use

### 2. Present findings and ask

Summarise what's present and what's missing. Then walk the user through the three decisions **one at a time** — present a section, get the user's answer, then move to the next. Don't dump all three at once.

Assume the user does not know what these terms mean. Each section starts with a short explainer (what it is, why these skills need it, what changes if they pick differently). Then show the choices and the default.

**Section A — Issue tracker.**

> Explainer: The "issue tracker" is where issues live for this repo. Skills like `to-issues`, `triage`, and `to-prd` read from and write to it — they need to know whether to call `gh issue create`, write a markdown file under `.scratch/`, or follow some other workflow you describe. Pick the place you actually track work for this repo.

Default posture: JPB's workflow is GitHub-first. If a `git remote` points at GitHub, propose GitHub. If a `git remote` points at GitLab (`gitlab.com` or a self-hosted host), propose GitLab. Otherwise (or if the user prefers), offer:

- **GitHub** — issues live in the repo's GitHub Issues (uses the `gh` CLI)
- **GitLab** — issues live in the repo's GitLab Issues (uses the [`glab`](https://gitlab.com/gitlab-org/cli) CLI)
- **Local markdown** — issues live as files under `.scratch/<feature>/` in this repo (good for solo projects or repos without a remote)
- **Other** (Jira, Linear, etc.) — ask the user to describe the workflow in one paragraph; the skill will record it as freeform prose

**Section B — Triage label vocabulary.**

> Explainer: When the `triage` skill processes an incoming issue, it moves it through a state machine — needs evaluation, waiting on reporter, ready for an AFK agent to pick up, ready for a human, or won't fix. To do that, it needs to apply labels (or the equivalent in your issue tracker) that match strings *you've actually configured*. If your repo already uses different label names (e.g. `bug:triage` instead of `needs-triage`), map them here so the skill applies the right ones instead of creating duplicates.

The five canonical roles:

- `needs-triage` — maintainer needs to evaluate
- `needs-info` — waiting on reporter
- `ready-for-agent` — fully specified, AFK-ready (an agent can pick it up with no human context)
- `ready-for-human` — needs human implementation
- `wontfix` — will not be actioned

Default: each role's string equals its name. Ask the user if they want to override any. If their issue tracker has no existing labels, the defaults are fine.

**Section C — Domain docs.**

> Explainer: Some skills (`improve-codebase-architecture`, `diagnose`, `tdd`) read a `CONTEXT.md` file to learn the project's domain language, and `docs/adr/` for past architectural decisions. They need to know whether the repo has one global context or multiple (e.g. a monorepo with separate frontend/backend contexts) so they look in the right place.

Confirm the layout:

- **Single-context** — one `CONTEXT.md` + `docs/adr/` at the repo root. Most repos are this.
- **Multi-context** — `CONTEXT-MAP.md` at the root pointing to per-context `CONTEXT.md` files (typically a monorepo).

### 3. Confirm and edit

For client projects that still use the old convention, you may offer to create:

- An `## Agent skills` section in the project's CLAUDE.md or AGENTS.md (if present)
- `docs/agents/issue-tracker.md`, `docs/agents/triage-labels.md`, `docs/agents/domain.md`

The JPB harness source repo (`~/dev/ai`) itself no longer uses or ships AGENTS.md, CLAUDE.md at root, or docs/agents/.

Present drafts of the configuration files the engineering skills actually consume (the three docs under docs/agents/ or equivalent) and let the user edit.

### 4. Write (client projects only)

Only write the old-style docs/agents/ files and/or update a guidelines file if the *target project* still expects them. The templates in this directory (issue-tracker-*.md, triage-labels.md, domain.md) remain available as seeds.

For "other" trackers, write a custom docs/agents/issue-tracker.md (or the equivalent location the user prefers).

### 5. Done

Tell the user the setup is complete for the target project. Note that the JPB harness source repo no longer maintains these files centrally — per-project setup is now optional and legacy for projects that want the explicit docs/agents/ layout.
