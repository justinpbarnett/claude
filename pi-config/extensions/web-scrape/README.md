# scrape pi extension

Global `scrape` tool for pi with progressive fallback tiers:

1. Basic fetch + Readability/Turndown extraction
2. `curl` with full Chrome-like headers
3. Playwright + Chromium for JavaScript-heavy pages
4. Bright Data Web Unlocker API via `curl` (optional, only if configured)

## Optional environment variables

The extension reads normal process env vars first, then falls back to:
- `~/.pi/agent/extensions/web-scrape/.env`

Useful command:
- `/scrape-status` — show active TLS mode, Bright Data status, zone, and detected Chromium path

Supported keys:
- `BRIGHTDATA_API_TOKEN` or `API_TOKEN` — Bright Data API token for tier 4
- `BRIGHTDATA_WEB_UNLOCKER_ZONE` or `WEB_UNLOCKER_ZONE` — Bright Data zone name (default: `mcp_unlocker`)
- `PI_SCRAPE_INSECURE_TLS` — if `true`, tiers 1 and 2 use insecure TLS (`curl -k`)
- `PI_SCRAPE_CA_CERT_PATH` — custom CA bundle path for tiers 1 and 2 (`curl --cacert ...`)
- `PI_SCRAPE_CHROMIUM_PATH` — override Chromium executable path for tier 3

## Notes

- Intended for publicly accessible pages only. The tool rejects obvious local/private hosts and authenticated URLs.
- Tier 4 is only attempted when allowed by the tool call and Bright Data is configured.
- Tier 4 uses `curl` by default on this machine because it is more reliable here than Node `fetch()`.
- In pi, tier 1 is adapted from the article's `WebFetch` idea into a lightweight fetch + content extraction pipeline, since pi does not ship a built-in WebFetch tool.
