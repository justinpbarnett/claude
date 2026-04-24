---
name: grill-me
description: >
  Relentlessly interview the user about a plan or design until shared understanding is reached, resolving each branch of the decision tree. Use when the user wants to stress test a plan, get grilled on a design, or says "grill me".
---

# Grill Me

Interview the user about a plan or design until the agent and user have a shared, concrete understanding.

## Variables

- `argument`: The plan, design, file path, or topic to interrogate.

## Instructions

### Step 0: Load The Plan

If `argument` points to a file, read it. If the prompt names relevant code, inspect the codebase before asking anything.

Extract:
- Goal and success criteria
- Users, stakeholders, and constraints
- Major design branches
- Dependencies between decisions
- Assumptions that could change the plan

### Step 1: Answer What The Codebase Can Answer

Before asking a question, check whether it can be answered by local exploration.

Use codebase evidence for:
- Existing behavior and patterns
- Current interfaces and data flow
- Dependency or framework choices
- Tests and verification shape
- Naming, file placement, and ownership

Only ask the user when the answer depends on intent, priority, tradeoff preference, product judgment, or external context not present in the repo.

### Step 2: Walk The Decision Tree

Resolve decisions in dependency order. Do not skip unresolved branches that affect later questions.

For each branch:
- State the decision being resolved
- Ask exactly one question
- Provide the recommended answer
- Explain the recommendation briefly

### Step 3: Continue Until Shared Understanding

After each user answer:
- Record the resolved decision
- Update dependent branches
- Revisit any prior assumption invalidated by the answer
- Ask the next highest leverage unresolved question

Stop only when the plan is concrete enough to execute or the remaining uncertainty is explicitly accepted.

## Output Format

```
Decision: <decision being resolved>

Question: <one clear question>

Recommended answer: <recommended answer>

Why: <brief rationale>
```

## Cookbook

<If: the user provides only a vague idea>
<Then: start with the outcome and success criteria before implementation details>

<If: the next question can be answered from the repo>
<Then: inspect the repo and record the answer instead of asking>

<If: a user answer conflicts with codebase evidence>
<Then: surface the conflict and ask one clarifying question with a recommended resolution>

<If: all major branches are resolved>
<Then: summarize the agreed decisions, remaining risks, and execution ready next step>
