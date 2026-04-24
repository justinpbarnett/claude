set shell := ["bash", "-euo", "pipefail", "-c"]

default:
    @just --list

sync:
    ./install.sh codex
