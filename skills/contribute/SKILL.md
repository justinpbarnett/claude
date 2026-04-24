---
name: contribute
description: >
  Vet and submit upstream fix or security contributions for a public GitHub
  repository using a 13 stage contribution pipeline. Default input is a public
  GitHub repository URL, such as https://github.com/owner/repo. Fork the target
  repository into ~/dev/, mine recent merged PRs and release diffs for
  candidates, reproduce locally before drafting anything, shape the writeup to
  the repo's recent accepted PR patterns, pause for human viability review and
  CLA signing, then resume for follow up after review or bot feedback. Use when
  asked to use "$contribute", contribute to a public GitHub repository,
  "contribute upstream", "fork this repo and prepare a PR", "hunt fix
  candidates", "run the 13 stage pipeline", or "prepare an honest open source
  contribution".
---

# Contribute

Method first. Stack second. Work directly by default. Use subagents only when the runtime permits them and the task has independent, bounded lanes. Do not skip the gates.

The two hard gates are:

1. Stage 5, local reproduction. No repro, no submission.
2. Stage 8, merge pattern matching. Shape the submission to what the repo actually merges.

## Input

- `argument`: Public GitHub repository URL by default, for example `https://github.com/owner/repo`.
- `owner/repo`: Also accepted; normalize it to `https://github.com/owner/repo`.
- Local checkout path: Only use when the user explicitly provides a path. Verify it points to the intended public upstream before proceeding.
- `--from=<stage>`: Resume from a later stage, usually `11`, `12`, or `13`.
- `--candidate=<slug>`: Resume a single surviving candidate if a prior run narrowed the field.

## Ownership

- Automation handles stages 1 through 10 and 13.
- Human handles stage 11 viability review and stage 12 CLA click through.
- Stop and hand off cleanly at the human stages.

## Setup

1. Treat the argument as a public GitHub repository URL unless it is clearly `owner/repo` or an explicit local path.
2. Normalize repository input to both `https://github.com/<owner>/<repo>` and `<owner>/<repo>`.
3. Verify the repository is publicly accessible before forking. If it is private, unsupported, or credential-gated, stop and report the blocker.
4. Use `/home/jpb/dev/<repo>` as the working directory. This means `~/dev/<repo>`, not `/dev/<repo>`.
5. If the directory does not exist, fork and clone it there with GitHub CLI. From `/home/jpb/dev`, run `gh repo fork <owner/repo> --clone --default-branch-only`.
6. If the directory already exists, verify that `origin` points to the user's fork and `upstream` points to the source repository. If remotes are wrong, stop and ask before touching them.
7. Keep the fork default branch clean. Create a working branch only after a candidate survives stage 3.

## Required command recipes

After input normalization, set these variables:

```bash
owner_repo="<owner>/<repo>"
repo_url="https://github.com/${owner_repo}"
repo_name="${owner_repo##*/}"
worktree="/home/jpb/dev/${repo_name}"
```

Verify public repository accessibility before forking:

```bash
gh repo view "$owner_repo" \
  --json nameWithOwner,isPrivate,defaultBranchRef,url \
  --jq 'if .isPrivate then error("private repository is unsupported") else [.url, .nameWithOwner, .defaultBranchRef.name] | @tsv end'
```

Stop if the command fails, reports a private repository, or returns a repository other than the normalized target.

Mine the last 20 merged PRs with file evidence:

```bash
gh pr list -R "$owner_repo" \
  --state merged \
  --limit 20 \
  --json number,title,mergedAt,url,changedFiles,additions,deletions,labels,files \
  --jq '.[] | {number, title, mergedAt, url, changedFiles, additions, deletions, labels: [.labels[].name], paths: [.files[].path]}'
```

Mine the last 5 release or version tags and compare adjacent diffs after the fork checkout exists:

```bash
git -C "$worktree" fetch upstream --tags --prune
mapfile -t release_tags < <(gh release list -R "$owner_repo" --limit 5 --exclude-drafts --json tagName --jq '.[].tagName')
if [ "${#release_tags[@]}" -eq 0 ]; then
  mapfile -t release_tags < <(git -C "$worktree" tag --sort=-creatordate | head -5)
fi
for i in "${!release_tags[@]}"; do
  current="${release_tags[$i]}"
  previous="${release_tags[$((i + 1))]:-}"
  [ -n "$previous" ] || continue
  git -C "$worktree" diff --name-status "$previous..$current"
done
```

Use the PR and release-diff output as candidate evidence. Do not create candidates from general intuition.

## Stage 1: Mine candidates

- Review the last 20 merged PRs.
- Review the last 5 release tag diffs. Prefer GitHub releases. If releases do not exist, use the most recent version like tags.
- Extract only fix or security candidates.
- Ignore features, cleanup, refactors, docs, and guesses with no anchor in real changes.

For each candidate capture:

- one sentence hypothesis
- why it might be a fix or security issue
- exact files, functions, or behaviors involved
- the evidence source, PR, release diff, commit, or code path

## Stage 2: Fit with project direction

Read recent merged PRs and CONTRIBUTING.
Drop any candidate that fights the repo's philosophy, roadmap, or maintainer preferences.

Reject quickly when the candidate:

- conflicts with stated non goals
- proposes policy the repo explicitly avoids
- expands scope beyond what recent merges accept

## Stage 3: Q00 / Ouroboros interview

Run a short adversarial interview on each remaining candidate. The agent decides if the candidate is worth branching for.

Ask:

1. What exact user or security failure is being claimed?
2. What direct evidence supports it?
3. What would falsify it?
4. What is the smallest local reproduction?
5. Could this be intentional or load bearing?
6. If accepted, what is the smallest acceptable fix or report?

If the candidate fails the interview, drop it.
If it survives, create a branch only for that candidate.

## Stage 4: Cross check and dedupe

Search open and closed issues and PRs.
Drop or merge notes when the same problem is already reported, fixed, rejected, or under discussion.
Prefer existing threads over duplicate new submissions.

## Stage 5: Reproduce locally

Reproduce in the fork checkout.
No repro, no submission.

Rules:

- Use a clean branch or clean worktree per candidate.
- Verify the failure on the current upstream default branch first.
- If the problem does not reproduce, drop it immediately.
- Save concrete proof: command output, failing test, stack trace, screenshot, or a minimal script.
- If a fix is obvious, implement the smallest proof fix and verify that it removes the failure.

This is the main noise filter. Treat it as a hard gate.

## Stage 6: Re examine intentional behavior

Anything load bearing or philosophy driven gets a second look.
If the behavior is intentional, subtle, or required by project constraints, exclude it even if it looks odd at first glance.

## Stage 7: Scope and appropriateness

Check the candidate against recent merge patterns.
The proposal should look like something maintainers actually merge:

- similar size
- similar evidence quality
- similar test depth
- similar blast radius
- similar tone

If the candidate is too broad, split it or drop it.

## Stage 8: Match accepted merge patterns

Read the repo's last 10 merged PRs carefully.
Use them to shape:

- title style
- PR body sections
- repro format
- test language
- tone and confidence level
- how much context is considered normal

Merge history outranks generic docs for submission shape.
This is the second hard gate.

## Stage 9: Draft the issue or PR

Choose the smallest honest submission:

- PR when you have a reproduced bug and a verified fix
- issue when you have reproduced proof but not a responsible fix yet

Draft must include:

- problem statement
- exact reproduction
- expected behavior
- actual behavior
- root cause or likely cause, if known
- fix summary, if PR
- validation performed
- scope boundaries

## Stage 10: Few shot polish from the user's merged PRs

Use the authenticated GitHub user unless the user names another handle.
Find a few previously merged PRs from that user, preferably in the same repo or ecosystem.
Borrow only the writing shape:

- title rhythm
- section order
- brevity level
- reviewer friendliness

Do not invent confidence or pad the writeup.

## Stage 11: Human viability review

Stop here and hand off.

Present:

- surviving candidate summary
- reproduction proof
- why it fits project direction
- why it matches recent merge patterns
- the drafted issue or PR text
- risks or reviewer objections you expect

Wait for explicit go or no go from the human before continuing.

## Stage 12: CLA flow

After human approval, run the automation needed to reach the CLA checkbox or signing screen.
If browser automation is available, use it to navigate to the point where the human must click.
If browser automation is not available, provide the exact URL and blocking step, then pause.

The human performs the actual signature or checkbox interaction.
Do not claim the CLA was signed unless the human confirms it.

## Stage 13: Follow up after feedback

After bot or reviewer feedback, choose one action:

1. update the same PR
2. leave a clarifying comment
3. close it and move on
4. open the next PR only if it passes the full method again

Rules:

- follow requests that stay within the accepted scope
- if new work changes the claim, rerun stages 5 through 8
- if rejection is philosophical or duplicate based, accept it and close cleanly
- do not argue with maintainers
- if a follow up becomes a new candidate, treat it as a new run

## Output format

Use this structure:

```text
Repository URL: https://github.com/<owner>/<repo>
Upstream contribution: <owner/repo>
Local fork: /home/jpb/dev/<repo>
Resume stage: <full run or N>

Stage 1: <count> raw candidates
Stage 2: <count> direction fit
Stage 3: <count> survived interview
Stage 4: <count> after dedupe
Stage 5: <count> reproduced
Stage 6: <count> still valid
Stage 7: <count> scoped
Stage 8: <count> merge shaped
Stage 9: <drafted issue or PR>
Stage 10: <polish source handle and examples>
Stage 11: paused for human viability review
Stage 12: paused for human CLA action
Stage 13: <follow up decision>

Proof:
- <reproduction evidence>
- <validation evidence>

Next action:
- <what the human or agent should do next>
```

## Decision rules

- Do less, better. One honest reproduced contribution beats ten speculative ones.
- If no candidates survive stage 5, stop with `no honest contribution found`.
- If stage 8 says the repo would not merge it in this form, reshape or drop it.
- Never open an issue or PR from inference alone.
- The method matters more than the specific automation stack.
