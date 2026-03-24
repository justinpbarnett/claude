# Promote

Convert git worktrees to regular branches for manual testing. Works with any project that uses worktrees for isolated development -- orchestrators, team agents, manual worktrees, etc.

## Trigger

"promote", "promote <identifier>", "ready to test", "convert worktree"

## Input

One of:
- A branch name or identifier (e.g., `feat/PTP-15978`, `PTP-15978`, `my-feature`)
- A worktree path
- If nothing provided, list active worktrees and ask which to promote

## Process

### 1. Discover worktrees

List all worktrees in the current repo:

```bash
git worktree list
```

If the user provided an identifier, filter to matching worktrees. If the project has multiple repos (check by looking for sibling directories that are also git repos), scan all of them.

For multi-repo projects like Passion Camp:
```bash
cd ~/dev/passion/passioncamp/app/client && git worktree list
cd ~/dev/passion/passioncamp/app/server && git worktree list
```

### 2. Check for associated PRs

```bash
BRANCH=$(git -C <worktree_path> branch --show-current)
gh pr list --head "$BRANCH" --json number,url,title,isDraft
```

### 3. Convert worktree to branch

For each matching worktree:

```bash
# Check for uncommitted changes
git -C <worktree_path> status --porcelain

# If uncommitted changes exist, commit them
git -C <worktree_path> add -A
git -C <worktree_path> commit -m "wip: uncommitted changes before promote"

# Remove the worktree (keeps the branch and all commits)
git worktree remove <worktree_path>

# Check out the branch in the main repo
git checkout <branch_name>
```

### 4. Mark PRs as ready for review

If draft PRs exist for the branch:
```bash
gh pr ready <PR_NUMBER>
```

### 5. Update orchestrator state (if applicable)

Check for known orchestrator state files and update status to "promoted":

- `~/dev/workshop/build/initiatives/passion-state.json` (Passion autopilot)
- `~/dev/workshop/build/initiatives/embers-tasks.json` (Embers orchestrator)

If on a remote machine (e.g., MacBook) and state lives on omarchy:
```bash
ssh jpb@omarchy "python3 -c \"import json,sys; f='build/initiatives/passion-state.json'; s=json.load(open(f)); k=sys.argv[1]; s.get('tickets',{}).get(k,{})['status']='promoted'; json.dump(s,open(f,'w'),indent=2)\" '<KEY>'"
```

### 6. Clean up

Remove any orchestrator temp files:
```bash
rm -f /tmp/passion-task-<KEY>.txt /tmp/passion-run-<KEY>.sh /tmp/passion-result-<KEY>.txt
```

### 7. Summary

Tell the user:
- Which branch is now checked out (per repo if multi-repo)
- Which PRs are ready for review (with URLs)
- Remind: smoke test, then approve and merge

## Notes

- If the worktree has uncommitted changes, always commit them before removing
- If no worktree exists but a matching branch does (local or remote), just check it out
- If nothing matches, inform the user clearly
- Works from any machine -- adapts SSH commands based on hostname
