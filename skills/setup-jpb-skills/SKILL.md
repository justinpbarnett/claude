---
name: setup-jpb-skills
description: Syncs JPB's repo-managed Matt Pocock skills, then sets up an `## Agent skills` block in AGENTS.md/CLAUDE.md and `docs/agents/` so JPB's skills know the repo's issue tracker, triage label vocabulary, and domain doc layout. Run before first use of `to-issues`, `to-prd`, `triage`, `diagnose`, `tdd`, `improve-codebase-architecture`, or `zoom-out` — or if those skills appear to be missing repo context.
disable-model-invocation: true
---

# Setup JPB Skills

Scaffold the per-repo configuration that JPB's engineering skills assume, and optionally sync the repo-managed Matt Pocock skills before doing so:

- **Matt Pocock skill sync** — refresh upstream engineering/productivity skills, remove upstream skills that Matt deprecated, and ask whether to add newly available upstream skills not already installed.
- **Issue tracker** — where issues live. Default to GitHub when the repo has a GitHub remote; local markdown and other trackers are also supported.
- **Triage labels** — the strings used for the five canonical triage roles.
- **Domain docs** — where `CONTEXT.md` and ADRs live, and the consumer rules for reading them.

This is a prompt-driven skill, not a deterministic script. Explore, present what you found, confirm with the user, then write.

## Process

### 0. Sync Matt Pocock skills

Before configuring the target repo, check whether the local JPB skill repo is available at `/home/jpb/dev/ai`. If it is, offer to sync Matt Pocock's upstream skills.

Explain:

> JPB's skill repo keeps selected Matt Pocock engineering/productivity skills as repo-managed copies. Syncing means: pull Matt's latest `main`, update text for installed upstream-synced skills, remove any installed upstream skill that Matt has moved to `deprecated/`, and ask before adding upstream skills that are available but not installed yet. Local JPB skills (`contribute`, `deep-audit`, `find-skills`, `setup-jpb-skills`) are preserved.

Ask the user whether to run the sync. If yes:

1. Clone or refresh Matt's repo in a temp directory:

   ```bash
   rm -rf /tmp/matt-skills
   git clone --depth 1 https://github.com/mattpocock/skills.git /tmp/matt-skills
   ```

2. Discover upstream sets:

   ```bash
   find /tmp/matt-skills/skills/engineering /tmp/matt-skills/skills/productivity -mindepth 1 -maxdepth 1 -type d -printf '%f\n' | sort
   find /tmp/matt-skills/skills/deprecated -mindepth 1 -maxdepth 1 -type d -printf '%f\n' | sort
   find /home/jpb/dev/ai/skills -mindepth 1 -maxdepth 1 -type d -printf '%f\n' | sort
   ```

3. Preserve these local JPB skills regardless of upstream state:

   ```text
   contribute
   deep-audit
   find-skills
   setup-jpb-skills
   ```

4. For installed skills that are present in Matt's `engineering/` or `productivity/`, replace the local copy with the upstream directory, except do **not** replace `setup-jpb-skills` with upstream `setup-matt-pocock-skills`.

5. For installed skills that are present in Matt's `deprecated/`, remove them from `/home/jpb/dev/ai/skills` and remove matching compatibility links from `~/.agents/skills` and `~/.pi/agent/skills`, unless they are one of the preserved local JPB skills.

6. For upstream engineering/productivity skills that are not currently installed, show the list to the user and ask which to add. Do not add all automatically.

7. After changes, verify upstream-synced skills are exact copies with `diff -qr`, and maintain compatibility links:

   ```bash
   for path in /home/jpb/dev/ai/skills/*; do
     skill=$(basename "$path")
     ln -sfn "/home/jpb/dev/ai/skills/$skill" "$HOME/.agents/skills/$skill"
     ln -sfn "/home/jpb/dev/ai/skills/$skill" "$HOME/.pi/agent/skills/$skill"
   done
   ```

8. Present a concise summary: updated, removed-as-deprecated, newly-added, skipped, and preserved-local.

If the user declines sync, continue to per-repo configuration.

### 1. Explore

Look at the current repo to understand its starting state. Read whatever exists; don't assume:

- `git remote -v` and `.git/config` — is this a GitHub repo? Which one?
- `AGENTS.md` and `CLAUDE.md` at the repo root — does either exist? Is there already an `## Agent skills` section in either?
- `CONTEXT.md` and `CONTEXT-MAP.md` at the repo root
- `docs/adr/` and any `src/*/docs/adr/` directories
- `docs/agents/` — does this skill's prior output already exist?
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

Show the user a draft of:

- The `## Agent skills` block to add to whichever of `CLAUDE.md` / `AGENTS.md` is being edited (see step 4 for selection rules)
- The contents of `docs/agents/issue-tracker.md`, `docs/agents/triage-labels.md`, `docs/agents/domain.md`

Let them edit before writing.

### 4. Write

**Pick the file to edit:**

- If `CLAUDE.md` exists, edit it.
- Else if `AGENTS.md` exists, edit it.
- If neither exists, ask the user which one to create — don't pick for them.

Never create `AGENTS.md` when `CLAUDE.md` already exists (or vice versa) — always edit the one that's already there.

If an `## Agent skills` block already exists in the chosen file, update its contents in-place rather than appending a duplicate. Don't overwrite user edits to the surrounding sections.

The block:

```markdown
## Agent skills

### Issue tracker

[one-line summary of where issues are tracked]. See `docs/agents/issue-tracker.md`.

### Triage labels

[one-line summary of the label vocabulary]. See `docs/agents/triage-labels.md`.

### Domain docs

[one-line summary of layout — "single-context" or "multi-context"]. See `docs/agents/domain.md`.
```

Then write the three docs files using the seed templates in this skill folder as a starting point:

- [issue-tracker-github.md](./issue-tracker-github.md) — GitHub issue tracker
- [issue-tracker-gitlab.md](./issue-tracker-gitlab.md) — GitLab issue tracker
- [issue-tracker-local.md](./issue-tracker-local.md) — local-markdown issue tracker
- [triage-labels.md](./triage-labels.md) — label mapping
- [domain.md](./domain.md) — domain doc consumer rules + layout

For "other" issue trackers, write `docs/agents/issue-tracker.md` from scratch using the user's description.

### 5. Done

Tell the user the setup is complete and which JPB engineering skills will now read from these files. Mention they can edit `docs/agents/*.md` directly later — re-running this skill is only necessary if they want to switch issue trackers or restart from scratch.
