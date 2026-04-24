set shell := ["bash", "-euo", "pipefail", "-c"]

default:
    @just --list

sync platform="all":
    ./install.sh {{platform}}
