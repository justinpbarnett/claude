---
name: write-a-skill
description: Create new agent skills with proper structure, progressive disclosure, and bundled resources. Use when user wants to create, write, or build a new skill.
---

# Writing Skills

## Process

1. **Gather requirements** - ask user about:
   - What task/domain does the skill cover?
   - What specific use cases should it handle?
   - Does it need executable scripts or just instructions?
   - Any reference materials to include?

2. **Draft the skill** - create:
   - SKILL.md with concise instructions
   - Additional reference files if content exceeds 500 lines
   - Utility scripts if deterministic operations needed

3. **Review with user** - present draft and ask:
   - Does this cover your use cases?
   - Anything missing or unclear?
   - Should any section be more/less detailed?

4. **Register global skills everywhere they are listed** - only do this when the user is creating a global/repo-managed skill for JPB's skill set. If the user is creating a one-off project-local skill, keep it in that project's chosen location and do not update global registries.

   For a global/repo-managed skill:
   - Add the skill under `/home/jpb/dev/ai/skills/<skill-name>/` — this repo is the source of truth.
   - Add/update compatibility links:
     ```bash
     ln -sfn "/home/jpb/dev/ai/skills/<skill-name>" "$HOME/.agents/skills/<skill-name>"
     ln -sfn "/home/jpb/dev/ai/skills/<skill-name>" "$HOME/.pi/agent/skills/<skill-name>"
     ```
   - Update `skills/find-skills/SKILL.md` anywhere the current skill set or local/custom skills are listed.
   - Update `skills/setup-jpb-skills/SKILL.md` if the new skill should be preserved during Matt Pocock upstream syncs, or if it changes setup behavior.
   - Search for other name lists before finishing:
     ```bash
     grep -R "contribute\|deep-audit\|find-skills\|setup-jpb-skills\|<skill-name>" -n AGENTS.md docs skills pi-config harness 2>/dev/null
     ```
   - Mention in the final response which registry/list files were updated.

   For a project-local skill:
   - Do not touch `/home/jpb/dev/ai/skills`, `~/.agents/skills`, or `~/.pi/agent/skills` unless the user explicitly asks.
   - Do not update `find-skills` or `setup-jpb-skills` unless the local skill changes global discovery/setup behavior.

## Skill Structure

```
skill-name/
├── SKILL.md           # Main instructions (required)
├── REFERENCE.md       # Detailed docs (if needed)
├── EXAMPLES.md        # Usage examples (if needed)
└── scripts/           # Utility scripts (if needed)
    └── helper.js
```

## SKILL.md Template

```md
---
name: skill-name
description: Brief description of capability. Use when [specific triggers].
---

# Skill Name

## Quick start

[Minimal working example]

## Workflows

[Step-by-step processes with checklists for complex tasks]

## Advanced features

[Link to separate files: See [REFERENCE.md](REFERENCE.md)]
```

## Description Requirements

The description is **the only thing your agent sees** when deciding which skill to load. It's surfaced in the system prompt alongside all other installed skills. Your agent reads these descriptions and picks the relevant skill based on the user's request.

**Goal**: Give your agent just enough info to know:

1. What capability this skill provides
2. When/why to trigger it (specific keywords, contexts, file types)

**Format**:

- Max 1024 chars
- Write in third person
- First sentence: what it does
- Second sentence: "Use when [specific triggers]"

**Good example**:

```
Extract text and tables from PDF files, fill forms, merge documents. Use when working with PDF files or when user mentions PDFs, forms, or document extraction.
```

**Bad example**:

```
Helps with documents.
```

The bad example gives your agent no way to distinguish this from other document skills.

## When to Add Scripts

Add utility scripts when:

- Operation is deterministic (validation, formatting)
- Same code would be generated repeatedly
- Errors need explicit handling

Scripts save tokens and improve reliability vs generated code.

## When to Split Files

Split into separate files when:

- SKILL.md exceeds 100 lines
- Content has distinct domains (finance vs sales schemas)
- Advanced features are rarely needed

## Review Checklist

After drafting, verify:

- [ ] Description includes triggers ("Use when...")
- [ ] SKILL.md under 100 lines
- [ ] No time-sensitive info
- [ ] Consistent terminology
- [ ] Concrete examples included
- [ ] References one level deep
- [ ] If global/repo-managed: skill lives in `/home/jpb/dev/ai/skills/<skill-name>/`
- [ ] If global/repo-managed: `~/.agents/skills/<skill-name>` and `~/.pi/agent/skills/<skill-name>` point back to the repo copy
- [ ] If global/repo-managed: `skills/find-skills/SKILL.md` includes the skill in the appropriate current-skill/local-custom list
- [ ] If global/repo-managed and local/custom: `skills/setup-jpb-skills/SKILL.md` preserves the skill during upstream syncs
- [ ] If global/repo-managed: grep for skill-name lists has been run and any relevant references are updated
