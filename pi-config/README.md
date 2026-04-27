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

Current portable extensions:

- `fireworks-compat`
- `inline-slash-autocomplete`
- `stash-draft`
- `web-scrape`
- `web-search`

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

This is a small wrapper around `install.sh --mode symlink`. In symlink mode, `~/dev/ai/pi-config` is the source of truth. pi global config points back to this repo, while local-only files such as extension `.env` files and `node_modules/` stay under `~/.pi/agent`.

If an existing managed file or directory needs to be replaced, it is moved into a timestamped backup directory under:

```bash
~/.local/state/pi-config-backups/
```

## Unlink this repo from global pi config

```bash
cd ~/dev/ai/pi-config
./uninstall.sh
```

The uninstall script removes only symlinks in `~/.pi/agent` that point into this repo. It does not remove local auth, sessions, extension `.env` files, or `node_modules/`.

Preview first with:

```bash
./uninstall.sh --dry-run
```

## Secrets and auth

After bootstrapping on a new machine:

1. Sign in to pi so it creates `auth.json` locally.
2. Recreate any extension `.env` files locally.
3. Restart pi after installing or updating config.

Do not commit local secrets or session data from `~/.pi/agent`.
