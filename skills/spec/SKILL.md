---
name: spec
description: >
  Collaboratively develops implementation specs through structured exploration.
  Acts as a design partner -- asking questions, presenting options, and making
  architecture and technical decisions together with the user. Use when a user
  wants to spec, plan, design, or scope work. Triggers on "spec a feature",
  "create a spec", "scope this work", "design the approach", "write a spec for",
  "let's spec this out", "spec this fix", "spec a refactor".
  Do NOT use for implementing or executing existing specs.
  Do NOT use for quick single-line changes that need no spec phase.
---

# Purpose

Acts as a collaborative design partner to develop comprehensive implementation specs. Instead of generating a spec in one pass, drives a multi-turn conversation that explores requirements, surfaces constraints, presents architectural options, and resolves decisions -- producing a fully-defined spec only after thorough exploration.

## Variables

- `argument` -- Task description and optional tracking ID (e.g., "spec a feature for user authentication -- ID is AUTH-042").

## Instructions

### Phase 1: Intake

Start by understanding the user's intent:

1. Extract the **type**, **prompt**, and optional **task_id** from the request
2. If the type is ambiguous, ask the user
3. Restate the goal in your own words and ask the user to confirm or correct

Do NOT proceed to research until you have a clear, confirmed understanding of what the user wants.

### Task Types

| Type         | Description                                             | Spec Depth                                                          |
| ------------ | ------------------------------------------------------- | ------------------------------------------------------------------- |
| **feat**     | A new feature                                           | Comprehensive -- user story, phases, testing strategy                |
| **fix**      | A bug fix                                               | Diagnostic -- reproduction steps, root cause, regression testing     |
| **refactor** | Code change that neither fixes a bug nor adds a feature | Architectural -- current/target state, migration strategy            |
| **perf**     | Code change that improves performance                   | Architectural -- baseline metrics, optimization strategy, benchmarks |
| **chore**    | Maintenance tasks (deps, configs, cleanup)              | Lightweight -- description, steps, validation                        |
| **docs**     | Documentation only changes                              | Lightweight                                                         |
| **test**     | Adding or correcting tests                              | Lightweight                                                         |
| **build**    | Build system or external dependency changes             | Lightweight                                                         |
| **ci**       | CI configuration and scripts                            | Lightweight                                                         |

### Phase 2: Research

Investigate the codebase to build context:

1. Read `README.md` for project overview, tech stack, and conventions
2. Explore files relevant to the task using Glob and Grep
3. Read existing code that will be modified or extended
4. Check `specs/` for related specs that provide context
5. Check for a task runner (justfile, Makefile, package.json scripts) to understand available commands

For complex features requiring deep investigation across multiple subsystems, delegate to the `research` agent.

After research, share a **Context Summary** with the user:

- What you found in the codebase that's relevant
- Existing patterns that will inform the design
- Constraints or limitations you discovered
- Adjacent features or systems that may be affected

This grounds the conversation in the actual codebase before making decisions.

Then present a **Decision Roadmap** -- a numbered list of the key decisions that need to be made for this task. For example:

> Based on what I found, here are the decisions we need to make:
> 1. Auth strategy (JWT vs sessions)
> 2. Token storage (cookies vs localStorage)
> 3. Endpoint structure
> 4. Error handling approach
> 5. Rate limiting
>
> Let's start with #1.

This gives the user visibility into the full shape of the conversation and where they are in it. The roadmap can evolve -- add or remove items as exploration reveals new considerations.

**If research reveals no meaningful decisions to make** -- the task is straightforward, the codebase patterns are clear, and the implementation path is obvious -- skip the exploration phase entirely. Tell the user: "This is straightforward -- no major decisions needed. Let me draft the spec." Then go directly to Phase 4.

### Phase 3: Explore

This is the core collaborative phase. Drive a focused conversation to fill in gaps and make decisions. Cover these areas as relevant to the task type:

**For all types:**

- Scope boundaries -- what's in, what's explicitly out
- Acceptance criteria -- how do we know it's done
- Constraints -- performance requirements, backwards compatibility, external dependencies

**For feat:**

- User stories and use cases
- Data model and schema changes
- API surface (endpoints, request/response shapes, error cases)
- State management and data flow
- UI/UX behavior (if applicable)
- Integration points with existing code

**For fix:**

- Reproduction steps and conditions
- Root cause hypothesis (present your analysis, get confirmation)
- Fix approach options with tradeoffs

**For refactor/perf:**

- Current pain points and why now
- Target architecture or performance goals
- Migration strategy and rollback plan

**How to explore effectively:**

- Ask 2-4 focused questions per turn, grouped by topic
- Present concrete options with tradeoffs rather than open-ended questions
- When you have a strong recommendation, lead with it: "I'd recommend X because Y. Does that work, or do you have a different preference?"
- Build on previous answers -- don't re-ask what's been established
- Reference the decision roadmap to show progress: "That settles #1 and #2. Moving to #3..."

**Running decisions summary:** After each exploration turn, maintain a visible summary of decisions made so far. Format as a compact list:

> **Decisions so far:** (1) JWT with refresh tokens, (2) httpOnly cookies, (3) pending...

This keeps both parties aligned and makes it easy to spot if a decision was misunderstood. Update the summary each turn as new decisions are made.

Continue exploring until:

- All architectural decisions are made
- All technical choices are resolved
- Scope boundaries are clear
- No open questions remain that would block implementation

### Phase 4: Draft

Once exploration is complete, signal that you're ready to write:

> I have everything I need. Let me draft the spec.

1. Select the appropriate template from `references/spec-templates.md` based on task type:
   - **feat** -- Comprehensive Spec template
   - **fix** -- Diagnostic Spec template
   - **refactor**, **perf** -- Architectural Spec template
   - **chore**, **docs**, **test**, **build**, **ci** -- Lightweight Spec template
2. Fill in every section with specific, researched content informed by the conversation
3. Every architectural and technical decision from the conversation must be reflected in the spec
4. The "Assumptions" section should be empty or near-empty -- that's the point of the exploration phase
5. Write the spec file to: `specs/{type}-{task_id}-{descriptive-name}.md`
   - Replace `{type}` with the conventional commit type
   - Replace `{task_id}` with the provided ID or descriptive slug
   - Replace `{descriptive-name}` with a short kebab-case name derived from the task

### Phase 5: Review

Present the spec to the user for final review:

1. Highlight the key decisions captured in the spec
2. Ask if anything needs adjustment
3. If the user requests changes, edit the spec and re-present
4. Once approved, confirm the final spec path

## Workflow

```
Phase 1: Intake
  │ Confirm understanding of the task
  │
Phase 2: Research
  │ Investigate codebase, share context summary
  │ Present decision roadmap
  │
Phase 3: Explore (multi-turn)
  │ ← back and forth with user →
  │ Work through decision roadmap
  │ Update running decisions summary each turn
  │ Continue until all decisions are made
  │
Phase 4: Draft
  │ Write the spec file (including Background section)
  │
Phase 5: Review
  │ Present spec, iterate if needed
  │
Done -- report spec file path
```

## Cookbook

<If: user provides a detailed brief with clear requirements>
<Then: acknowledge what's clear, skip to researching and exploring only the gaps. Don't ask questions the user already answered.>

<If: user gives a vague one-liner like "spec auth">
<Then: start with broader intake questions to understand scope before researching.>

<If: lightweight type (chore, docs, test, build, ci)>
<Then: abbreviate the exploration phase. These tasks need less design discussion. Ask 1-2 clarifying questions max, then draft.>

<If: research reveals the task is straightforward with no meaningful decisions>
<Then: skip exploration entirely. Go straight from research to drafting. Examples: adding a simple endpoint that follows an existing pattern, a bug fix with an obvious root cause and one clear fix, a refactor with a well-understood target state. The decision roadmap would be empty or trivial, so don't force a conversation.>

<If: user says "just write it" or "skip questions">
<Then: respect the request. Do your best with available context, research the codebase thoroughly, and draft the spec. Note assumptions in the Assumptions section.>

<If: user disagrees with your recommendation>
<Then: accept their decision. Ask follow-up questions only if their choice introduces new technical considerations that need resolving.>

<If: exploration reveals the task is larger than expected>
<Then: surface this to the user with specifics. Suggest breaking it into multiple specs if appropriate. Let the user decide.>

<If: user wants to change direction mid-exploration>
<Then: acknowledge the pivot, summarize what's still valid from prior discussion, and continue from the new direction.>

<If: scope is unclear or requirements are ambiguous>
<Then: present concrete options with tradeoffs. "We could do A (simpler, less flexible) or B (more work, but extensible). Which fits better?">

<If: research phase reveals no relevant codebase context (greenfield or new area)>
<Then: note this and lean more heavily on the exploration phase to establish conventions and patterns for the new area.>

## Validation

Before finalizing, verify:

- Every placeholder in the template has been replaced with specific content
- All referenced files actually exist in the codebase (or are clearly marked as new)
- Step-by-step tasks are ordered correctly with dependencies respected
- Validation commands are runnable and specific
- The spec follows existing codebase patterns and conventions
- All decisions from the exploration phase are captured in the spec
- The Assumptions section is empty or contains only non-blocking items

## Examples

### Example 1: Feature Spec (Multi-turn Collaboration)

**User says:** "Spec a feature for user authentication"

**Turn 1 (Intake):**
Restate: "You want to add user authentication to the project. Before I dig in -- are we talking login/signup with email+password, OAuth/social login, or both? And is there an existing user model or are we starting fresh?"

**Turn 2 (Research + Context Summary + Decision Roadmap):**
After user answers, research the codebase. Share context and roadmap:

"I found the project uses Express with PostgreSQL. There's no existing user model or auth middleware. The API follows RESTful patterns in `src/routes/`. I see bcrypt is already in package.json but unused.

Here are the decisions we need to make:
1. Auth strategy (JWT vs sessions)
2. Token storage and refresh approach
3. Password hashing strategy
4. Endpoint structure and error responses
5. Rate limiting approach

Let's start with #1."

**Turn 3 (Explore -- decisions 1-2):**
Present JWT vs sessions with tradeoffs, get decision. Follow up on token storage.

> **Decisions so far:** (1) JWT with refresh tokens, (2) httpOnly cookies

**Turn 4 (Explore -- decisions 3-5):**
Cover remaining decisions, presenting options for each.

> **Decisions so far:** (1) JWT with refresh tokens, (2) httpOnly cookies, (3) bcrypt with 12 rounds, (4) 4 endpoints -- register/login/refresh/logout, (5) rate limit login to 5 attempts per 15min

**Turn 5 (Draft):**
"All decisions made. Let me draft the spec." Write `specs/feat-user-auth.md`.

**Turn 6 (Review):**
"Here's the spec with all 5 decisions captured. Anything you'd change?"

### Example 2: Bug Fix (Shorter Exploration)

**User says:** "Spec a fix for the health endpoint returning 500 when the database is down"

**Turn 1 (Intake + Research + Roadmap):**
Research the health endpoint code. Share findings: "The health handler at `src/routes/health.ts:15` calls `db.ping()` without a try-catch. When the DB is down, the unhandled rejection crashes the handler.

Decisions to make: (1) error handling approach, (2) response shape for degraded state.

For #1, two options: (A) wrap in try-catch, return degraded status, or (B) add a timeout so the health check doesn't hang. I'd recommend both -- catch the error and add a 3s timeout. Thoughts?"

**Turn 2 (Draft + Review):**
After user confirms, write `specs/fix-health-endpoint-db-error.md`. Present for review.

### Example 3: User Skips Exploration

**User says:** "Just spec out adding a /metrics endpoint, don't need a bunch of back and forth"

**Turn 1:**
Research codebase, draft spec directly with best-judgment decisions. Note assumptions in the Assumptions section. Present the spec for review in case adjustments are needed.
