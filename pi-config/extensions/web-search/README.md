# Web Search

Global Pi extension that adds a `web-search` tool backed by the Brave Search API.

## What it does

- searches the public web through Brave
- returns ranked results with titles, URLs, snippets, and mixed section data
- supports focused queries like docs-only via `resultTypes: ["web"]`
- works well with `web-scrape` when you want full page content after discovery
- automatically retries once on short Brave rate-limit responses

## Configuration

Add one of these to `~/.pi/agent/extensions/web-search/.env` or your shell environment:

- `BRAVE_SEARCH_API_KEY`
- `BRAVE_API_KEY`
- `BRAVE_SEARCH_SUBSCRIPTION_TOKEN`

Then run `/reload` in Pi.

## Tool name

- `web-search`

## Parameter aliases

The tool accepts both Pi-friendly names and Brave-style API names for the most common fields.

Examples:

- `query` or `q`
- `searchLanguage` or `search_lang`
- `uiLanguage` or `ui_lang`
- `safeSearch` or `safesearch`
- `resultTypes` or `result_filter`
- `extraSnippets` or `extra_snippets`
- `textDecorations` or `text_decorations`

## Suggested workflow

1. use `web-search` to discover likely sources
2. use `web-scrape` on promising result URLs when you need actual page content

## Notes

- Brave commonly enforces a short per-second rate limit, so bursts may back off briefly
- full output is truncated safely and written to a temp file when needed
