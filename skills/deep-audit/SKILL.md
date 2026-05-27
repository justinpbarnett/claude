---
name: deep-audit
description: >
  Comprehensive code audit using parallel specialist agents. Spawns 8-10 agents 
  to analyze code from different angles: git history, task intent reconciliation,
  DRY violations, architecture optimization, code quality, test coverage, and more.
  Collects all findings, then kicks off fix agents in a loop until no issues 
  remain. Use for thorough code reviews, pre-commit audits, quality gates, or
  when you want to ensure code meets high standards. Triggers on 
  "deep audit", "comprehensive review", "full code review", "audit this",
  "check code quality", "ensure standards", "quality gate".
---

# Deep Audit (Multi-Agent with Fix Loop)

Comprehensive code review using parallel analysis agents. Each agent focuses on one quality dimension. After analysis, fix agents address issues in a loop until clean.

## Trigger

"deep audit", "comprehensive review", "full code review", "audit this", 
"check code quality", "ensure standards", "quality gate"

## Process

### Step 1: Collect Context

Determine audit scope:
- **Scope**: Entire branch, specific files, or git diff only?
- **Base branch**: `main`/`master` for comparison
- **Original intent**: Spec file, PR description, or commit messages
- **Strictness**: `strict` (all issues must fix) or `advisory` (critical only)

### Step 2: Launch Parallel Analysis Agents

Spawn 8-10 agents simultaneously to analyze different quality dimensions:

```
@git-history-analyzer
Analyze git history for:
- Commit message quality and consistency
- Commit granularity (atomic vs bloated)
- Author patterns (solo vs collaboration)
- Merge history cleanliness
- File churn (files changed repeatedly may indicate instability)

Report: commit_quality_score, suspicious_patterns, recommendations
```

```
@intent-reconciler
Reconcile current code with original intent:
- Read original spec/PR description if available
- Check commit messages for stated goals
- Verify the code actually does what was requested
- Identify scope creep or missing features
- Flag "todo" comments that should be done

Report: intent_match_score, deviations_found, missing_features
```

```
@dry-checker
Check for DRY (Don't Repeat Yourself) violations:
- Duplicate code blocks (use Grep for patterns)
- Repeated logic that should be functions
- Similar conditionals that could be unified
- Copy-pasted code with minor variations
- Magic numbers/strings repeated

Report: dry_violations_count, refactoring_opportunities, estimated_savings
```

```
@architecture-optimizer
Review architecture decisions:
- Coupling between modules (check imports)
- Cohesion within modules
- Abstraction level appropriateness
- Design pattern usage (correct/wrong/overkill)
- Separation of concerns
- API design consistency
- Database query efficiency (N+1 detection)

Report: architecture_score, coupling_issues, improvement_suggestions
```

```
@code-quality-analyzer
Analyze code quality metrics:
- Function length (too long = hard to test)
- Cyclomatic complexity (nested conditionals)
- Naming quality (clear intent?)
- Comment quality (outdated? helpful?)
- Error handling completeness
- Edge case coverage in logic
- Type safety (if applicable)

Report: quality_score, complex_functions, naming_issues, error_gaps
```

```
@test-coverage-checker
Check testing approach (not running tests, checking existence):
- Are new features tested?
- Test quality (assertions meaningful?)
- Edge cases covered?
- Test naming clarity
- Mock usage appropriateness
- Test file organization

Report: coverage_assessment, untested_features, test_quality_score
```

```
@performance-analyzer
Lightweight performance review:
- Obvious N+1 queries
- Unnecessary object allocations in loops
- String concatenation patterns
- Database query patterns
- Caching opportunities
- Algorithmic complexity (obvious O(n²) issues)

Report: performance_score, hotspots_found, quick_wins
```

```
@security-linter
Quick security checks:
- Hardcoded secrets (API keys, passwords)
- Input validation gaps
- SQL injection risks (string concatenation)
- XSS vulnerabilities (unescaped output)
- Auth bypass patterns
- Insecure dependencies (check for known CVEs)

Report: security_score, critical_findings, warnings
```

```
@documentation-completeness-checker
Check docs are complete:
- README updated for new features?
- Code comments for complex logic?
- Function docstrings present?
- API docs updated?
- Migration guides if needed?
- Breaking changes documented?

Report: docs_score, missing_docs, outdated_docs
```

```
@standards-compliance-checker
Check project standards:
- Linting rules compliance
- Code style consistency
- Import ordering
- File naming conventions
- Project-specific patterns (from CLAUDE.md, AGENTS.md, or coding standards docs)
- Language-specific best practices

Report: compliance_score, violations_found
```

### Step 3: Synthesize Findings

Wait for all agents to return. Categorize findings:

**Critical (Block merge):**
- Security vulnerabilities
- Intent mismatch (code doesn't do what was asked)
- Broken functionality
- Missing critical tests

**Major (Should fix):**
- DRY violations affecting maintainability
- High complexity functions
- Architecture coupling issues
- Performance hotspots

**Minor (Nice to have):**
- Naming improvements
- Comment additions
- Style inconsistencies
- Documentation gaps

**Advisory (FYI):**
- Git history suggestions
- Alternative approaches
- Future improvements

### Step 4: Fix Loop (Auto-Trigger)

**ALWAYS run fix loop if ANY of these conditions are met:**
- Critical issues found (security, broken functionality)
- Major issues found (DRY violations, high complexity, missing tests)
- Overall score is below 80/100
- User explicitly says "fix" or "fix issues"

**Do NOT skip the fix loop unless:**
- User says "just report" or "analysis only" or uses `--no-fix` flag
- Only advisory/minor issues found AND score is above 80

**If conditions met, proceed with:**

```
Round 1: Spawn fix agents
@code-fixer-1, @code-fixer-2, @code-fixer-3
Each takes subset of issues:
- Fix DRY violations by extracting functions
- Simplify complex functions
- Add missing error handling
- Improve naming
- Add missing tests
```

After fixes applied:
```
Round 2: Re-audit
Spawn @quick-validator agent:
- Verify fixes didn't break anything
- Run validation commands
- Check git diff is reasonable

If new issues found → Round 3 (up to 3 rounds max)
If clean → proceed to Step 5
```

### Step 5: Ask User, Then Fix

**After presenting the audit report:**

**If issues were found:**
```
## Deep Audit Complete

[Present the full report above]

---
**Issues Found:** [X critical, Y major, Z minor]
**Current Score:** [X]/100

Would you like me to:
1. **Fix all issues** - Spawn fix agents for critical and major issues (recommended)
2. **Fix critical only** - Address just the critical/blocking issues  
3. **Skip fixes** - Just report, no changes

Default: Proceed with fixing critical and major issues in 3 rounds max.
```

**If no significant issues:**
```
✅ **Audit Passed** - Score: [X]/100
No fixes needed. Code looks good!
```

### Step 6: Execute Fix Loop (If User Approves)

**Spawn fix agents based on issue types:**

```
Round 1: Initial Fixes
@code-fixer-dry - Fix DRY violations
@code-fixer-quality - Fix complexity and quality issues  
@code-fixer-architecture - Fix architecture/coupling issues
@code-fixer-tests - Generate missing tests

Each agent:
1. Takes assigned issues from the audit report
2. Applies fixes following project patterns
3. Runs lint/typecheck after changes
4. Reports what was fixed with file:line references
```

**After Round 1:**
```
Round 2: Validation
@quick-validator:
- Run lint and typecheck
- Check git diff is reasonable
- Verify no breaking changes

If validation passes → Go to Round 3 (Final Check)
If issues remain → Go back to Round 1 with remaining issues (max 3 rounds)
```

**Round 3: Final Verification**
- Re-run critical analyzers to confirm fixes worked
- Generate final report with before/after scores

### Step 7: Final Report

```markdown
# Deep Audit Report: [Branch/Feature]

## Executive Summary
- **Overall Score**: X/100
- **Status**: [PASS / NEEDS_WORK / CRITICAL_ISSUES]
- **Fix Rounds**: [N rounds applied]
- **Issues Fixed**: [count]
- **Remaining**: [count]

## Analysis Breakdown

| Dimension | Score | Status | Key Finding |
|-----------|-------|--------|-------------|
| Git History | 85/100 | ✓ | Clean commits |
| Intent Match | 100/100 | ✓ | Fully implemented |
| DRY | 70/100 | ⚠ | 3 duplications found |
| Architecture | 90/100 | ✓ | Good separation |
| Code Quality | 75/100 | ⚠ | 2 complex functions |
| Test Coverage | 80/100 | ✓ | Well tested |
| Performance | 95/100 | ✓ | No major issues |
| Security | 100/100 | ✓ | Clean scan |
| Documentation | 65/100 | ⚠ | README needs update |
| Standards | 90/100 | ✓ | Mostly compliant |

## Critical Issues
*None found* (or list with file:line references)

## Major Issues Fixed
- [What was fixed and how]

## Remaining Advisory Items
- [Minor suggestions not blocking]

## Action Items
1. [If any manual follow-up needed]
```

## Configuration

### Strictness Levels

**strict**: All major+ issues must be fixed before passing
**advisory**: Only critical issues block, others are suggestions
**quick**: Only run critical checks (security, intent, tests)

### Flags

- `--scope=files` - Audit specific files only
- `--base=branch` - Compare against specific branch (default: main)
- `--strictness=level` - Set strictness level
- `--max-rounds=N` - Max fix iterations (default: 3)
- `--no-fix` - Analysis only, don't auto-fix

## Cookbook

<If: audit finds critical security issues>
<Then: stop immediately, report security findings, require manual fix.>

<If: intent-reconciler finds major deviations>
<Then: ask user if intent changed or if code is wrong.>

<If: fix loop runs 3 rounds and still has major issues>
<Then: stop and report remaining issues for manual review.>

<If: architecture-optimizer suggests major restructuring>
<Then: flag as advisory unless it causes real bugs.>

<If: git-history-analyzer finds messy commits>
<Then: suggest interactive rebase or squash before merge.>

<If: multiple agents find issues in same file>
<Then: prioritize fixing that file - it's likely problematic.>
