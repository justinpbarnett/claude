# CLAUDE.md Template

Use this structure when generating a project's CLAUDE.md. Adapt sections to the project -- omit sections that don't apply, add project-specific sections as needed.

## Template

```md
# <Project Name>

<One-line description of what the project does.>

## Stack

- <Language version, framework, key libraries>
- <ORM + database>
- <Deployment target>
- <Package manager>

## Key Commands

```bash
<task_runner> <command>    # <description>
<task_runner> <command>    # <description>
<task_runner> <command>    # <description>
```

## Architecture

- `<dir>/` -- <purpose>
- `<dir>/` -- <purpose>
- `<dir>/` -- <purpose>

## Testing

- <test framework> (`<test directory>`)
- <e2e framework if applicable>

## Domain Rules

- <project-specific conventions, naming, tone, constraints>
```

## Notes

- Keep it under 100 lines. CLAUDE.md is loaded into every conversation -- brevity matters.
- Commands should be copy-pasteable. Use the actual task runner (just, make, pnpm, etc.).
- Architecture section should cover top-level directories only. Don't go deeper than 2 levels.
- Domain Rules captures things that aren't obvious from the code: business logic constraints, naming conventions, tone guidelines, external API quirks.
- If the project has an ADW/automation system, add a brief section for it.
- If the project has integrations with external services, list them.
