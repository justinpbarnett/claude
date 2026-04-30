---
name: find-skills
description: Helps users discover which installed repo-managed skill to use, and whether a missing capability should be added to this repo's skills source of truth. Use when users ask "how do I do X", "find a skill for X", "is there a skill that can...", or ask about extending agent capabilities.
---

# Find Skills

This repo is the source of truth for JPB's installed skills.

Canonical skill directory:

```text
/home/jpb/dev/ai/skills
```

Compatibility links point back here:

```text
~/.agents/skills/<skill> -> /home/jpb/dev/ai/skills/<skill>
~/.pi/agent/skills/<skill> -> /home/jpb/dev/ai/skills/<skill>
```

Do **not** install or update skills directly into `~/.agents/skills` or `~/.pi/agent/skills`. If a skill is added or changed, update this repo first, then ensure those global links point back to the repo copy.

## Current Skill Set

### Upstream-synced Matt Pocock skills

These should stay word-for-word identical to the matching skill directories from:

```text
https://github.com/mattpocock/skills/tree/main/skills
```

Included categories: **engineering** and **productivity** only, except where a local JPB fork is listed below.

Current upstream-synced skills:

- `caveman` — ultra-compressed communication mode
- `diagnose` — disciplined diagnosis/debugging loop
- `grill-me` — stress-test a plan through questioning
- `grill-with-docs` — grill a plan and update context/ADR docs
- `improve-codebase-architecture` — find architectural refactoring opportunities
- `tdd` — red/green/refactor workflow
- `to-issues` — break plans/specs into issues
- `to-prd` — turn conversation context into a PRD
- `triage` — triage issues through a label/state machine
- `write-a-skill` — create new skills
- `zoom-out` — step back and reassess direction/context

When checking or refreshing these, clone/pull Matt's repo and copy only the desired `skills/engineering/*` and `skills/productivity/*` directories into this repo's flat `skills/<name>/` layout. Then verify exactness with `diff -qr`.

### Local/custom JPB skills

These are intentionally local to this repo and do not need to match Matt's upstream repo:

- `contribute` — upstream contribution pipeline
- `deep-audit` — comprehensive multi-angle code audit
- `find-skills` — this skill; documents JPB's local skill setup and discovery process
- `setup-jpb-skills` — JPB-specific per-repo setup for issue tracker, triage labels, and domain docs

Keep these unless the user explicitly asks to remove them.

## When to Use This Skill

Use this skill when the user:

- Asks which existing skill applies to a task
- Asks whether a capability is already installed
- Wants to add, remove, sync, or audit skills
- Mentions Matt Pocock's skills, JPB skills, or exact upstream copies
- Asks about `~/.agents/skills`, `~/.pi/agent/skills`, or repo skill symlinks

## Discovery Process

### 1. Check installed repo skills first

List available skills from the repo source of truth:

```bash
find /home/jpb/dev/ai/skills -maxdepth 2 -name SKILL.md -printf '%h\n' | sed 's#^/home/jpb/dev/ai/skills/##' | sort
```

Read likely candidates' `SKILL.md` files before recommending them.

### 2. Explain the best current fit

Recommend an installed skill when one matches. Mention why it fits and any important trigger phrase.

Examples:

- Debugging/failing behavior → `diagnose`
- Test-first feature/fix → `tdd`
- Architecture cleanup → `improve-codebase-architecture`
- Convert plan to issues → `to-issues`
- Create PRD → `to-prd`
- Triage/file issues → `triage`
- Configure a repo for the engineering skills → `setup-jpb-skills`
- Write a new skill → `write-a-skill`
- Upstream OSS contribution → `contribute`
- Broad quality review → `deep-audit`
- Need brevity → `caveman`

### 3. If no installed skill fits, search upstream

For Matt skills, inspect:

```bash
git clone --depth 1 https://github.com/mattpocock/skills.git /tmp/matt-skills
find /tmp/matt-skills/skills -maxdepth 3 -name SKILL.md -print
```

Only recommend adding from Matt's repo if it is in `engineering` or `productivity`, unless the user explicitly asks for another category.

For non-Matt skills, use web/search or the relevant ecosystem only after confirming the repo skill set has no fit.

### 4. Adding or syncing skills

For Matt engineering/productivity syncs, preserve local/custom JPB skills. In particular, do not overwrite `setup-jpb-skills` with upstream `setup-matt-pocock-skills` unless the user explicitly asks to revert to upstream.

```bash
remote=/tmp/matt-skills
repo=/home/jpb/dev/ai
for category in engineering productivity; do
  for src in "$remote/skills/$category"/*; do
    name=$(basename "$src")
    [ "$name" = "setup-matt-pocock-skills" ] && continue
    rm -rf "$repo/skills/$name"
    cp -a "$src" "$repo/skills/$name"
    diff -qr "$src" "$repo/skills/$name"
  done
done
```

Then maintain compatibility links:

```bash
for path in /home/jpb/dev/ai/skills/*; do
  skill=$(basename "$path")
  ln -sfn "/home/jpb/dev/ai/skills/$skill" "$HOME/.agents/skills/$skill"
  ln -sfn "/home/jpb/dev/ai/skills/$skill" "$HOME/.pi/agent/skills/$skill"
done
```

Remove global links for deleted skills so Pi does not expose stale capabilities.

## Important Rules

- This repo is the source of truth.
- Matt upstream-synced skills should remain exact upstream copies.
- Do not edit upstream-synced Matt skills directly unless the user explicitly wants a fork/divergence.
- Keep `contribute`, `deep-audit`, `find-skills`, and `setup-jpb-skills` as local/custom skills.
- Do not use `npx skills add -g` as the default install path; it bypasses this repo source-of-truth setup.
