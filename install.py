#!/usr/bin/env python3
"""
AI Harness Installer — data-driven from harnesses.toml

This is the single source of truth for installing/uninstalling skills and
per-harness config files across all supported AI coding tools.

Usage:
    ./install.py [harness|all]...
    ./install.py --uninstall [harness|all]...

The old install.sh / uninstall.sh are thin wrappers for convenience.
"""

from __future__ import annotations

import argparse
import shutil
import sys
import tomllib
from datetime import datetime
from pathlib import Path
from typing import Any

REPO_DIR = Path(__file__).resolve().parent
CONFIG_FILE = REPO_DIR / "harnesses.toml"


def expand_path(p: str) -> Path:
    """Expand ~ and make absolute."""
    return Path(p).expanduser().resolve()


def load_config() -> dict[str, Any]:
    if not CONFIG_FILE.exists():
        print(f"ERROR: {CONFIG_FILE} not found", file=sys.stderr)
        sys.exit(1)
    with CONFIG_FILE.open("rb") as f:
        return tomllib.load(f)


def get_harness_names(config: dict[str, Any]) -> list[str]:
    # Top-level tables that are not sections like "comment" keys
    return [k for k in config if isinstance(config[k], dict) and "target" in config[k]]


def backup_path(target: Path) -> Path:
    ts = datetime.now().strftime("%Y%m%d%H%M%S")
    return target.with_suffix(target.suffix + f".bak.{ts}") if target.suffix else target.with_name(target.name + f".bak.{ts}")


def link_file(source: Path, target: Path, *, dry_run: bool = False) -> None:
    """Create a symlink from source to target, with backup if needed."""
    if not source.exists():
        print(f"    SKIP {target.name} (source missing: {source})")
        return

    if target.is_symlink() and target.resolve() == source.resolve():
        print(f"    KEEP {target.name}")
        return

    if target.exists() or target.is_symlink():
        backup = backup_path(target)
        if not dry_run:
            target.rename(backup)
        print(f"    BACKUP {target.name} -> {backup.name}")

    if target.is_symlink():
        if not dry_run:
            target.unlink()

    if not dry_run:
        target.parent.mkdir(parents=True, exist_ok=True)
        target.symlink_to(source)

    print(f"    LINK {target.name} -> {source}")


def link_children(source_dir: Path, target_dir: Path, *, dry_run: bool = False) -> None:
    """Symlink each child of source_dir into target_dir (used by codex, droid, etc.)."""
    if not source_dir.is_dir():
        print(f"    SKIP {target_dir.name} (source dir missing)")
        return

    target_dir.mkdir(parents=True, exist_ok=True)

    # Clean up stale managed links first
    for child in list(target_dir.iterdir()):
        if child.is_symlink():
            try:
                dest = child.resolve()
                if dest.is_relative_to(source_dir):
                    if not dest.exists():
                        if not dry_run:
                            child.unlink()
                        print(f"    REMOVE stale {child.name}")
            except Exception:
                pass

    for src in sorted(source_dir.iterdir()):
        if not src.is_dir() and not src.is_file():
            continue
        name = src.name
        tgt = target_dir / name
        link_file(src, tgt, dry_run=dry_run)


def install_harness(name: str, hcfg: dict[str, Any], *, dry_run: bool = False) -> None:
    target = expand_path(hcfg["target"])
    print(f"\nInstalling {name}...")
    print(f"  Target: {target}")

    symlinks: dict[str, str] = hcfg.get("symlinks", {})
    skills_mode = hcfg.get("skills_mode", "directory")

    for tgt_name, src_rel in symlinks.items():
        # Convention: key = name in target harness, value = path relative to repo root
        src = REPO_DIR / src_rel

        if src_rel == "skills" or tgt_name == "skills" or tgt_name.endswith("-skills"):
            # Special skills handling (supports skills_mode + skills_name override)
            if skills_mode == "children":
                tgt_dir = target / tgt_name
                link_children(src, tgt_dir, dry_run=dry_run)
            else:
                tgt = target / tgt_name
                link_file(src, tgt, dry_run=dry_run)
            continue

        # Normal file or directory
        tgt = target / tgt_name
        link_file(src, tgt, dry_run=dry_run)


def uninstall_harness(name: str, hcfg: dict[str, Any], *, dry_run: bool = False) -> None:
    target = expand_path(hcfg["target"])
    print(f"\nUninstalling {name}...")
    print(f"  Target: {target}")

    symlinks: dict[str, str] = hcfg.get("symlinks", {})
    skills_mode = hcfg.get("skills_mode", "directory")

    for tgt_name, src_rel in symlinks.items():
        tgt = target / tgt_name

        if src_rel == "skills":
            if skills_mode == "children":
                tgt_dir = target / tgt_name
                if tgt_dir.exists():
                    for child in list(tgt_dir.iterdir()):
                        if child.is_symlink():
                            try:
                                if child.resolve().is_relative_to(REPO_DIR / "skills"):
                                    if not dry_run:
                                        child.unlink()
                                    print(f"    REMOVE {child.name}")
                            except Exception:
                                pass
                    try:
                        if not any(tgt_dir.iterdir()):
                            tgt_dir.rmdir()
                            print(f"    RMDIR {tgt_dir.name}")
                    except Exception:
                        pass
            else:
                if tgt.is_symlink():
                    if not dry_run:
                        tgt.unlink()
                    print(f"    REMOVE {tgt.name}")
            continue

        if tgt.is_symlink():
            if not dry_run:
                tgt.unlink()
            print(f"    REMOVE {tgt.name}")


def main() -> None:
    parser = argparse.ArgumentParser(description="Install/uninstall AI coding harness configs")
    parser.add_argument("harnesses", nargs="*", help="Harness names or 'all'")
    parser.add_argument("--uninstall", "-u", action="store_true", help="Uninstall instead of install")
    parser.add_argument("--dry-run", action="store_true", help="Print actions without making changes")
    parser.add_argument("--list", action="store_true", help="List available harnesses")
    args = parser.parse_args()

    config = load_config()
    available = get_harness_names(config)

    if args.list:
        for name in available:
            target = config[name].get("target", "")
            print(f"{name:12} -> {target}")
        return

    if not args.harnesses:
        print("Available harnesses:", ", ".join(available))
        print("Use 'all' to select everything.")
        return

    selected = []
    for h in args.harnesses:
        if h == "all":
            selected = available
            break
        if h not in available:
            print(f"Unknown harness: {h}", file=sys.stderr)
            print("Available:", ", ".join(available), file=sys.stderr)
            sys.exit(1)
        selected.append(h)

    for name in selected:
        hcfg = config[name]
        if args.uninstall:
            uninstall_harness(name, hcfg, dry_run=args.dry_run)
        else:
            install_harness(name, hcfg, dry_run=args.dry_run)

    if not args.dry_run:
        print("\nDone. Restart your coding harness(es) to pick up changes.")


if __name__ == "__main__":
    main()
