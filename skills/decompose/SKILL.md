---
name: decompose
description: >
  Analyzes a feature spec and decomposes it into smaller, focused sub-tasks
  when the feature is too large for a single agent. Produces a task graph
  with mini-specs for each sub-task. Use when a user wants to break down
  a large feature, decompose a spec, split a plan into subtasks, or when
  a spec is too big to implement in one pass. Triggers on "decompose this
  spec", "break this down", "split into subtasks", "this is too big".
  Do NOT use for implementing features (use the implement skill).
  Do NOT use for creating specs (use the spec skill).
---

# Purpose

Analyzes a feature spec and determines whether it should be decomposed into smaller sub-tasks. For small features, outputs a single-task graph. For large features, breaks the work into focused sub-tasks with mini-specs.

## Variables

- `argument` — Two space-separated values: `{spec_file_path} {task_id}` (e.g., `specs/feat-user-auth.md AUTH-042`). If no task_id is provided, derive one from the spec filename.

## Instructions

### Step 1: Read the Spec

Read the full feature spec file. Identify:

1. **Implementation steps** — The numbered steps or tasks
2. **Files touched** — All files listed in "Relevant Files"
3. **New files** — Files that need to be created
4. **Dependencies between steps** — Which steps depend on which

### Step 2: Evaluate Complexity

Decide whether decomposition is needed. If the spec would take more than one focused session to implement (roughly: many implementation steps across many files with distinct concerns), decompose it. If the work is cohesive and manageable, keep it as a single task.

### Step 3a: Single Task (No Decomposition)

If the feature is small enough for a single agent, output a task graph JSON with `is_decomposed: false` pointing to the original spec file. No mini-specs are created.

### Step 3b: Decompose into Sub-Tasks

If the feature needs decomposition:

1. **Group related steps** into focused sub-tasks:
   - **Data model + migration** → early task (stage 1), other tasks depend on it
   - **Service/business logic** → separate task per service, depends on data model
   - **Route/API endpoints** → depends on services
   - **Components/Pages** → can parallelize (same stage if independent)
   - **Tests** → bundled with the thing they test
   - **Seed/fixture data** → separate late task

2. **Assign stages** — Stage 1 has no dependencies. Stage N depends on prior stages.

3. **Create mini-specs** at `specs/subtasks/{task_id}/{sub_task_id}.md` — each containing only the scope, steps, relevant files, and validation for that sub-task. Reference the parent spec for full context.

4. **Output the task graph** as JSON to stdout.

### Step 4: Output Task Graph JSON

Output clean, parseable JSON as the final output:

```json
{
  "parent_spec": "{spec_file_path}",
  "task_id": "{task_id}",
  "is_decomposed": true,
  "tasks": [
    {
      "id": "task-1-data-model",
      "title": "Add data model and migration",
      "stage": 1,
      "spec_file": "specs/subtasks/{task_id}/task-1-data-model.md",
      "depends_on": [],
      "status": "pending"
    }
  ]
}
```

## Workflow

1. **Read** — Parse the spec file path and task ID
2. **Analyze** — Evaluate complexity
3. **Decide** — Single task or decompose
4. **Write** — Create mini-spec files if decomposing
5. **Output** — Print task graph JSON

## Cookbook

<If: spec has cohesive, manageable scope>
<Then: output single-task graph with is_decomposed: false. Do not create mini-specs.>

<If: steps have clear data → service → route → UI layering>
<Then: decompose by layer, with each layer in a successive stage.>

<If: multiple independent UI components or pages>
<Then: assign them the same stage so they can run in parallel.>

<If: spec is ambiguous about step boundaries>
<Then: prefer larger sub-tasks over smaller ones. 3-5 sub-tasks is ideal. Avoid more than 8.>

<If: all steps are tightly coupled and cannot be separated>
<Then: output single-task graph even if the feature is large. Note this in the output.>

## Validation

- Task graph JSON is valid and parseable
- All `spec_file` paths point to files that exist
- Stage numbering starts at 1
- `depends_on` references are valid task IDs
- No circular dependencies
