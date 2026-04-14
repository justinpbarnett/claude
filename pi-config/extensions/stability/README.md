# stability

Global Pi extension for long-session reliability.

## What it does
- shows context pressure through `setStatus()`
- shows a small warning widget when sessions get heavy
- proactively compacts before context gets too full
- uses repo/profile-aware compaction instructions when available
- creates lightweight checkpoints
- adds sparse `/tree` labels for compactions and major edit turns
- can optionally create git snapshot refs before risky mutations

## Commands
- `/stability` -- show the current stability panel
- `/checkpoint [label]` -- create a manual checkpoint
- `/stability-compact [extra instructions]` -- compact now using stability rules

## Config
Global config:
- `~/.pi/agent/extensions/stability/config.json`

Repo-local overrides:
- `<repo>/.pi/stability.json`
- `<repo>/.pi/compaction.md`
- `<repo>/.pi/compaction.<profile>.md`
