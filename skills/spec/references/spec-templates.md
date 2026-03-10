# Spec Templates

Use the template matching the task type. Replace every placeholder (wrapped in angle brackets) with specific, researched content.

---

## Shared: Metadata Block

All specs start with this metadata block:

```md
## Metadata

type: `{type}`
task_id: `{task_id}`
```

## Output Templates by Type

Use the template that matches the `type` field in the metadata. Every spec starts with the metadata block, then follows the type-specific structure below.

---

### `feat` -- Feature Implementation

```md
# Feature: <feature name>

## Metadata

type: `feat`
task_id: `<task id or slug>`

## Background

<codebase context that informed the design -- relevant existing patterns, adjacent systems, technical constraints discovered during research. Makes the spec self-contained for an implementer who wasn't part of the exploration conversation.>

## Feature Description

<synthesize the problem and desired outcome into a clear feature description>

## User Story

As a <type of user>
I want to <action/goal>
So that <benefit/value>

## Scope

### In Scope

<what this feature covers -- be specific>

### Out of Scope

<what this feature explicitly does not cover -- prevents scope creep during implementation>

## Acceptance Criteria

<concrete, testable conditions that must be true for the feature to be considered complete>

- [ ] <criterion>
- [ ] <criterion>
- [ ] <criterion>

## Relevant Files

<list existing files relevant to the feature with bullet points explaining why>

### New Files

<list new files that need to be created with bullet points explaining their purpose>

## Decisions

<key architectural and technical decisions made during spec exploration, with brief rationale>

| Decision | Choice | Rationale |
| -------- | ------ | --------- |
| <what was decided> | <what was chosen> | <why> |

## Implementation Plan

<break implementation into logical phases -- let the phases emerge from the feature's needs rather than forcing a fixed structure>

### Phase 1: <phase name>

<description of work in this phase>

### Phase 2: <phase name>

<description of work in this phase>

## Step by Step Tasks

IMPORTANT: Execute every step in order, top to bottom.

### 1. <First Task Name>

- <specific action with file path and function name>
- <specific action>

### 2. <Second Task Name>

- <specific action>
- <specific action>

## Testing Strategy

### Unit Tests

<specific test files to create, cases to cover>

### Edge Cases

<edge cases derived from acceptance criteria and constraints>

## Risks & Mitigations

| Risk | Impact | Mitigation |
| ---- | ------ | ---------- |
| <what could go wrong> | <severity and blast radius> | <how to prevent or recover> |

## Validation Commands

Run these commands to verify the implementation is complete.

<project's actual check/lint/test commands to verify completion>

## Assumptions

<decisions accepted during exploration that might be revisited, or items explicitly deferred to implementation time -- should be near-empty if exploration was thorough>
```

---

### `fix` -- Bug Fix

```md
# Fix: <bug name>

## Metadata

type: `fix`
task_id: `<task id or slug>`

## Background

<codebase context relevant to the bug -- how the affected code path works, related systems, constraints discovered during research.>

## Bug Description

<what happens vs. what should happen>

## Reproduction Steps

1. <step>
2. <step>
3. <observe: incorrect behavior>

**Expected behavior:** <what should happen>

## Root Cause Analysis

<trace through the code path -- identify the exact failure point with file paths and line numbers>

## Relevant Files

<list files relevant to the fix with bullet points explaining why>

## Decisions

<key decisions made about the fix approach, with brief rationale>

| Decision | Choice | Rationale |
| -------- | ------ | --------- |
| <what was decided> | <what was chosen> | <why> |

## Fix Strategy

<targeted approach to fix without introducing side effects>

## Step by Step Tasks

IMPORTANT: Execute every step in order, top to bottom.

### 1. <First Task Name>

- <specific action with file path and function name>
- <specific action>

## Regression Testing

### Tests to Add

<new tests that verify the fix and prevent regression>

### Existing Tests to Verify

<existing tests that must still pass>

## Risks & Mitigations

| Risk | Impact | Mitigation |
| ---- | ------ | ---------- |
| <what could go wrong> | <severity and blast radius> | <how to prevent or recover> |

## Validation Commands

Run these commands to verify the implementation is complete.

<project's actual check/lint/test commands>

## Assumptions

<decisions accepted during exploration that might be revisited -- should be near-empty if exploration was thorough>
```

---

### `refactor` -- Refactoring

```md
# Refactor: <refactor name>

## Metadata

type: `refactor`
task_id: `<task id or slug>`

## Background

<codebase context that informed the refactor -- how the current code evolved, why it's structured this way, constraints discovered during research.>

## Refactor Description

<what is being refactored and why the current approach is problematic>

## Scope

### In Scope

<what this refactor covers>

### Out of Scope

<what this refactor explicitly does not touch>

## Current State

<current code architecture, patterns, or structure -- with file paths>

## Target State

<desired architecture, patterns, or structure after refactoring>

## Relevant Files

<list files with bullet points explaining why>

### New Files

<new files if needed>

## Decisions

<key architectural decisions made during spec exploration, with brief rationale>

| Decision | Choice | Rationale |
| -------- | ------ | --------- |
| <what was decided> | <what was chosen> | <why> |

## Migration Strategy

<how to move from current to target state -- backwards compatibility, incremental steps>

## Step by Step Tasks

IMPORTANT: Execute every step in order, top to bottom.

### 1. <First Task Name>

- <specific action>
- <specific action>

## Testing Strategy

<how to verify behavior is unchanged -- existing tests that must pass, new tests for coverage gaps>

## Risks & Mitigations

| Risk | Impact | Mitigation |
| ---- | ------ | ---------- |
| <what could go wrong> | <severity and blast radius> | <how to prevent or recover> |

## Validation Commands

Run these commands to verify the implementation is complete.

<project's actual check/lint/test commands>

## Assumptions

<decisions accepted during exploration that might be revisited -- should be near-empty if exploration was thorough>
```

---

### `perf` -- Performance Optimization

```md
# Perf: <optimization name>

## Metadata

type: `perf`
task_id: `<task id or slug>`

## Background

<codebase context relevant to the performance issue -- how the affected code path works, current architecture, constraints discovered during research.>

## Performance Issue Description

<what is slow and what impact it has>

## Baseline Metrics

- <metric>: <current value or how to measure>
- <metric>: <current value or how to measure>

## Target Metrics

- <metric>: <target value>
- <metric>: <target value>

## Relevant Files

<list files with bullet points explaining why>

## Decisions

<key optimization decisions made during spec exploration, with brief rationale>

| Decision | Choice | Rationale |
| -------- | ------ | --------- |
| <what was decided> | <what was chosen> | <why> |

## Optimization Strategy

<what changes will improve performance and why>

## Step by Step Tasks

IMPORTANT: Execute every step in order, top to bottom.

### 1. <First Task Name>

- <specific action>
- <specific action>

## Benchmarking Plan

<how to measure improvement -- specific commands, tools, test scenarios>

## Risks & Mitigations

| Risk | Impact | Mitigation |
| ---- | ------ | ---------- |
| <what could go wrong> | <tradeoffs -- memory vs speed, complexity vs performance> | <how to prevent or recover> |

## Validation Commands

Run these commands to verify the implementation is complete.

<project's actual check/lint/test commands>

## Assumptions

<decisions accepted during exploration that might be revisited -- should be near-empty if exploration was thorough>
```

---

### `chore`, `docs`, `test`, `build`, `ci` -- Lightweight Tasks

```md
# <Type>: <task name>

## Metadata

type: `<type>`
task_id: `<task id or slug>`

## Description

<synthesize the task -- what needs to happen and why>

## Relevant Files

<list files with bullet points explaining why>

### New Files

<new files if needed>

## Step by Step Tasks

IMPORTANT: Execute every step in order, top to bottom.

### 1. <First Task Name>

- <specific action>
- <specific action>

## Validation Commands

Run these commands to verify the implementation is complete.

<project's actual check/lint/test commands>

## Notes

<additional context or considerations>
```
