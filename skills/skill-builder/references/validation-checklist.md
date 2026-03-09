# Skill Validation Checklist

Run this checklist against every skill before finalizing.

## Structure

- [ ] Folder named in kebab-case
- [ ] SKILL.md exists (exact case)
- [ ] Frontmatter has only `name` and `description` -- no other fields
- [ ] `name` is kebab-case, matches folder name
- [ ] `description` includes WHAT, WHEN, and WHEN NOT
- [ ] No XML tags in frontmatter
- [ ] No README.md in the skill folder
- [ ] SKILL.md under 500 lines

## Sections

- [ ] `# Purpose` exists with 1-2 sentence summary
- [ ] `## Variables` exists (even if "no additional input")
- [ ] `## Instructions` exists with numbered steps
- [ ] `## Workflow` exists with high-level overview
- [ ] `## Cookbook` exists with at least one `<If:>` / `<Then:>` recipe

## Skill Reuse

- [ ] No step reimplements what an existing skill already does
- [ ] Steps that overlap with existing skills delegate via `/skill-name`
- [ ] The skill's description includes negative triggers pointing to skills it delegates to (e.g., "Do NOT use for committing changes (use the commit skill)")

## Quality

- [ ] Instructions are specific and actionable
- [ ] Error handling covers likely failure modes
- [ ] References linked from SKILL.md body where relevant

## Triggering

- [ ] Description includes natural trigger phrases
- [ ] Description includes negative triggers
- [ ] Would trigger on paraphrased requests
- [ ] Would NOT trigger on unrelated queries
