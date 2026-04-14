# pi portable config

This directory stores the portable part of `~/.pi/agent` for this repo.

## What is tracked

Tracked items are copied from or linked into the target pi config directory:

- `settings.json`
- `models.json`
- `keybindings.json`, if present
- `AGENTS.md`, `SYSTEM.md`, `APPEND_SYSTEM.md`, if present
- `prompts/`, `skills/`, `themes/`, `agents/`, if present
- portable files inside `extensions/`

## What stays local

These are intentionally excluded and should be created on each machine as needed:

- `auth.json`
- `sessions/`
- `git/`
- `bin/`
- `pi-debug.log`
- extension secrets such as `.env`
- extension local npm cache directories such as `.npm/`
- `node_modules/`

## Install on another machine

Clone this repo, then run:

```bash
cd ~/dev/ai/pi-config
./install.sh
```

By default this links the portable config into `~/.pi/agent`.

To target a different location:

```bash
PI_CODING_AGENT_DIR=/path/to/pi/agent ./install.sh
```

To copy files instead of linking them:

```bash
./install.sh --mode copy
```

The installer creates missing directories, preserves local state that is not managed here, and runs `npm install` in each target extension directory that contains a `package.json`.

## Link this repo on the current machine

```bash
cd ~/dev/ai/pi-config
./link-local.sh
```

This is a small wrapper around `install.sh --mode symlink`.

If an existing managed file or directory needs to be replaced, it is moved into a timestamped backup directory under:

```bash
~/.local/state/pi-config-backups/
```

## Secrets and auth

After bootstrapping on a new machine:

1. Sign in to pi so it creates `auth.json` locally.
2. Recreate any extension `.env` files locally.
3. Restart pi after installing or updating config.

Do not commit local secrets or session data from `~/.pi/agent`.
