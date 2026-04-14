import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import {
	DEFAULT_MAX_BYTES,
	DEFAULT_MAX_LINES,
	formatSize,
	truncateTail,
} from "@mariozechner/pi-coding-agent";
import { StringEnum } from "@mariozechner/pi-ai";
import { Type } from "@sinclair/typebox";
import { Readability } from "@mozilla/readability";
import { JSDOM } from "jsdom";
import { chromium } from "playwright-core";
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { isIP } from "node:net";
import { homedir } from "node:os";
import { join } from "node:path";
import TurndownService from "turndown";
import { gfm } from "turndown-plugin-gfm";

const TOOL_NAME = "scrape";
const CHROME_USER_AGENT =
	"Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";
const SIMPLE_HEADERS: Record<string, string> = {
	"user-agent": CHROME_USER_AGENT,
	accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
	"accept-language": "en-US,en;q=0.9",
};
const CURL_HEADERS = [
	"Accept: text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8",
	"Accept-Language: en-US,en;q=0.9",
	"Accept-Encoding: gzip, deflate, br",
	"DNT: 1",
	"Connection: keep-alive",
	"Upgrade-Insecure-Requests: 1",
	"Sec-Fetch-Dest: document",
	"Sec-Fetch-Mode: navigate",
	"Sec-Fetch-Site: none",
	"Sec-Fetch-User: ?1",
	"Cache-Control: max-age=0",
] as const;
const DEFAULT_EXTRA_WAIT_MS = 1_500;
const MAX_EXTRA_WAIT_MS = 15_000;
const FETCH_TIMEOUT_MS = 15_000;
const CURL_TIMEOUT_SECONDS = 25;
const CURL_CONNECT_TIMEOUT_SECONDS = 10;
const CURL_RETRY_COUNT = 1;
const PLAYWRIGHT_GOTO_TIMEOUT_MS = 20_000;
const PLAYWRIGHT_NETWORK_IDLE_TIMEOUT_MS = 5_000;
const BRIGHTDATA_TIMEOUT_MS = 30_000;
const BRIGHTDATA_ENDPOINT = "https://api.brightdata.com/request";
const PI_AGENT_DIR = process.env.PI_CODING_AGENT_DIR?.trim() || join(homedir(), ".pi", "agent");
const EXTENSION_ENV_PATH = join(PI_AGENT_DIR, "extensions", "web-scrape", ".env");
const CURL_META_SENTINEL = "__PI_SCRAPE_META__";
const JS_HEAVY_HOST_SUFFIXES = [".vercel.app", ".netlify.app"];
const JS_HEAVY_HTML_PATTERNS = [
	/__NEXT_DATA__/i,
	/id=["']__next["']/i,
	/id=["']__nuxt["']/i,
	/id=["']root["']/i,
	/id=["']app["']/i,
	/data-reactroot/i,
	/window\.__INITIAL_STATE__/i,
	/<script[^>]+type=["']module["']/i,
	/ng-version=/i,
] as const;
const BLOCK_PATTERNS = [
	/just a moment/i,
	/enable javascript and cookies/i,
	/verify you are human/i,
	/verify you are a human/i,
	/please verify you are human/i,
	/attention required/i,
	/access denied/i,
	/request unsuccessful/i,
	/checking your browser/i,
	/challenge-platform/i,
	/captcha/i,
	/hcaptcha/i,
	/recaptcha/i,
	/cloudflare/i,
	/incapsula/i,
	/akamai/i,
	/perimeterx/i,
	/datadome/i,
] as const;

type TierName = "tier1" | "tier2" | "tier3" | "tier4";
type TierPreference = "auto" | TierName;
type ContentMode = "article" | "full";
type ExtractionStrategy = "readability" | "body" | "plain_text" | "brightdata_markdown";

interface ScrapeAttemptSummary {
	tier: TierName;
	ok: boolean;
	statusCode?: number;
	finalUrl?: string;
	reason?: string;
	chars?: number;
	extraction?: ExtractionStrategy;
	ms: number;
}

interface ScrapeSuccess {
	title?: string;
	finalUrl: string;
	statusCode?: number;
	markdown: string;
	textLength: number;
	extraction: ExtractionStrategy;
}

class ScrapeAttemptError extends Error {
	readonly code: string;
	readonly statusCode?: number;
	readonly finalUrl?: string;
	readonly chars?: number;
	readonly extraction?: ExtractionStrategy;

	constructor(
		message: string,
		options: {
			code: string;
			statusCode?: number;
			finalUrl?: string;
			chars?: number;
			extraction?: ExtractionStrategy;
		},
	) {
		super(message);
		this.name = "ScrapeAttemptError";
		this.code = options.code;
		this.statusCode = options.statusCode;
		this.finalUrl = options.finalUrl;
		this.chars = options.chars;
		this.extraction = options.extraction;
	}
}

export default function webScrapeExtension(pi: ExtensionAPI) {
	const detectedChromiumPath = detectChromiumPath();

	pi.registerCommand("scrape-status", {
		description: "Show scrape tool configuration and runtime status",
		handler: async (_args, ctx) => {
			const tls = getTierTlsConfig();
			const lines = [
				`tool: ${TOOL_NAME}`,
				`env file: ${existsSync(EXTENSION_ENV_PATH) ? EXTENSION_ENV_PATH : "not found"}`,
				`tls mode: ${tls.insecure ? "insecure" : tls.caCertPath ? `custom CA (${tls.caCertPath})` : "system trust"}`,
				`bright data: ${getBrightDataApiToken() ? "configured" : "not configured"}`,
				`bright data zone: ${getBrightDataZone()}`,
				`chromium path: ${detectedChromiumPath ?? "not detected"}`,
			];
			ctx.ui.notify(lines.join("\n"), "info");
		},
	});

	pi.registerTool({
		name: TOOL_NAME,
		label: "Scrape",
		description:
			"Scrape a public webpage to markdown using a progressive four-tier fallback system: simple fetch, curl with complete browser headers, Playwright browser automation, then Bright Data as a paid last resort.",
		promptSnippet:
			"Scrape public webpages to markdown using progressive fallback tiers: fetch -> browser-like curl -> Playwright -> Bright Data.",
		promptGuidelines: [
			"Use this tool for public webpage scraping instead of ad-hoc bash/curl commands.",
			"Use tierPreference: \"tier3\" for known JavaScript-heavy sites like Vercel or Netlify apps, or when earlier attempts returned empty content.",
			"Use tierPreference: \"tier4\" only when the user explicitly asks for Bright Data or lower tiers are likely to fail.",
			"This tool is for publicly accessible content only, not login-protected or authenticated pages.",
		],
		parameters: Type.Object({
			url: Type.String({ description: "Public webpage URL to scrape" }),
			tierPreference: Type.Optional(
				StringEnum(["auto", "tier1", "tier2", "tier3", "tier4"] as const),
			),
			contentMode: Type.Optional(StringEnum(["article", "full"] as const)),
			allowPaidTier: Type.Optional(
				Type.Boolean({
					description:
						"Allow Bright Data tier 4 if configured. Defaults to true.",
				}),
			),
			extraWaitMs: Type.Optional(
				Type.Integer({
					minimum: 0,
					maximum: MAX_EXTRA_WAIT_MS,
					description:
						"Additional milliseconds to wait after page load in tier 3. Defaults to 1500.",
				}),
			),
		}),
		async execute(_toolCallId, params, signal, onUpdate) {
			const url = normalizeUrl(params.url);
			const tierPreference = (params.tierPreference ?? "auto") as TierPreference;
			const contentMode = (params.contentMode ?? "article") as ContentMode;
			const allowPaidTier = params.allowPaidTier !== false;
			const extraWaitMs = Math.min(
				Math.max(params.extraWaitMs ?? DEFAULT_EXTRA_WAIT_MS, 0),
				MAX_EXTRA_WAIT_MS,
			);
			const brightDataConfigured = Boolean(getBrightDataApiToken());
			const tierPlan = buildTierPlan(url, tierPreference, allowPaidTier, brightDataConfigured);

			if (tierPlan.length === 0) {
				return {
					content: [
						{
							type: "text",
							text:
								"No usable scrape tiers are available. Bright Data tier 4 was requested, but BRIGHTDATA_API_TOKEN/API_TOKEN is not configured.",
						},
					],
					details: {
						url,
						tierPreference,
						brightDataConfigured,
						chromiumPath: detectedChromiumPath,
					},
					isError: true,
				};
			}

			const attempts: ScrapeAttemptSummary[] = [];
			for (const tier of tierPlan) {
				publishUpdate(onUpdate, `Trying ${formatTierName(tier)}...`);
				const startedAt = Date.now();
				try {
					const result = await runTier({
						tier,
						url,
						contentMode,
						extraWaitMs,
						signal,
						chromiumPath: detectedChromiumPath,
						pi,
					});
					attempts.push({
						tier,
						ok: true,
						statusCode: result.statusCode,
						finalUrl: result.finalUrl,
						chars: result.textLength,
						extraction: result.extraction,
						ms: Date.now() - startedAt,
					});

					const rendered = renderSuccessOutput({
						url,
						result,
						tierUsed: tier,
						attempts,
					});
					publishUpdate(onUpdate, `${formatTierName(tier)} succeeded.`);
					return {
						content: [{ type: "text", text: rendered }],
						details: {
							url,
							finalUrl: result.finalUrl,
							title: result.title,
							tierUsed: tier,
							contentMode,
							attempts,
							extraction: result.extraction,
							brightDataConfigured,
							chromiumPath: detectedChromiumPath,
						},
					};
				} catch (error) {
					const formattedError = formatAttemptError(error);
					attempts.push({
						tier,
						ok: false,
						statusCode: formattedError.statusCode,
						finalUrl: formattedError.finalUrl,
						reason: formattedError.message,
						chars: formattedError.chars,
						extraction: formattedError.extraction,
						ms: Date.now() - startedAt,
					});
					publishUpdate(
						onUpdate,
						`${formatTierName(tier)} failed: ${formattedError.message}`,
					);
				}
			}

			return {
				content: [
					{
						type: "text",
						text: renderFailureOutput({
							url,
							attempts,
							allowPaidTier,
							brightDataConfigured,
							chromiumPath: detectedChromiumPath,
						}),
					},
				],
				details: {
					url,
					contentMode,
					tierPreference,
					attempts,
					brightDataConfigured,
					chromiumPath: detectedChromiumPath,
				},
				isError: true,
			};
		},
	});
}

function normalizeUrl(input: string): string {
	const trimmed = input.trim();
	if (!trimmed) throw new Error("URL cannot be empty");
	const candidate = /^[a-z][a-z\d+.-]*:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
	const url = new URL(candidate);
	if (url.protocol !== "http:" && url.protocol !== "https:") {
		throw new Error("Only http and https URLs are supported");
	}
	if (url.username || url.password) {
		throw new Error("Authenticated URLs are not supported by this public scrape tool");
	}
	if (isBlockedPublicTarget(url.hostname)) {
		throw new Error("Only public webpages are supported; local and private hosts are blocked");
	}
	return url.toString();
}

function isBlockedPublicTarget(hostname: string): boolean {
	const host = hostname.toLowerCase();
	if (
		host === "localhost" ||
		host.endsWith(".localhost") ||
		host.endsWith(".local") ||
		host.endsWith(".internal") ||
		host.endsWith(".home.arpa")
	) {
		return true;
	}
	const version = isIP(host);
	if (version === 4) return isPrivateIPv4(host);
	if (version === 6) return isPrivateIPv6(host);
	return false;
}

function isPrivateIPv4(host: string): boolean {
	const parts = host.split(".").map((part) => Number.parseInt(part, 10));
	if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) {
		return false;
	}
	const [a, b] = parts;
	if (a === 10 || a === 127 || a === 0) return true;
	if (a === 169 && b === 254) return true;
	if (a === 192 && b === 168) return true;
	if (a === 172 && b >= 16 && b <= 31) return true;
	if (a === 100 && b >= 64 && b <= 127) return true;
	return false;
}

function isPrivateIPv6(host: string): boolean {
	const normalized = host.toLowerCase();
	return (
		normalized === "::1" ||
		normalized.startsWith("fc") ||
		normalized.startsWith("fd") ||
		normalized.startsWith("fe8") ||
		normalized.startsWith("fe9") ||
		normalized.startsWith("fea") ||
		normalized.startsWith("feb")
	);
}

let cachedExtensionEnv: Record<string, string> | undefined;

function loadExtensionEnv(): Record<string, string> {
	if (cachedExtensionEnv) return cachedExtensionEnv;
	if (!existsSync(EXTENSION_ENV_PATH)) {
		cachedExtensionEnv = {};
		return cachedExtensionEnv;
	}

	const values: Record<string, string> = {};
	const content = readFileSync(EXTENSION_ENV_PATH, "utf8");
	for (const rawLine of content.split(/\r?\n/u)) {
		const line = rawLine.trim();
		if (!line || line.startsWith("#")) continue;
		const normalized = line.startsWith("export ") ? line.slice(7).trim() : line;
		const separatorIndex = normalized.indexOf("=");
		if (separatorIndex === -1) continue;
		const key = normalized.slice(0, separatorIndex).trim();
		if (!key) continue;
		let value = normalized.slice(separatorIndex + 1).trim();
		if (
			(value.startsWith('"') && value.endsWith('"')) ||
			(value.startsWith("'") && value.endsWith("'"))
		) {
			value = value.slice(1, -1);
		}
		values[key] = value;
	}
	cachedExtensionEnv = values;
	return values;
}

function getConfiguredEnv(name: string): string | undefined {
	const runtimeValue = process.env[name]?.trim();
	if (runtimeValue) return runtimeValue;
	const fileValue = loadExtensionEnv()[name]?.trim();
	return fileValue || undefined;
}

function publishUpdate(
	onUpdate:
		| ((partial: { content: Array<{ type: "text"; text: string }>; details?: Record<string, unknown> }) => void)
		| undefined,
	text: string,
) {
	onUpdate?.({ content: [{ type: "text", text }] });
}

function detectChromiumPath(): string | undefined {
	const envPath = getConfiguredEnv("PI_SCRAPE_CHROMIUM_PATH");
	if (envPath) return envPath;
	const probe = spawnSync(
		"bash",
		[
			"-lc",
			[
				"command -v chromium",
				"command -v chromium-browser",
				"command -v google-chrome-stable",
				"command -v google-chrome",
				"command -v chrome",
			].join(" || "),
		],
		{ encoding: "utf8" },
	);
	const found = probe.stdout?.trim();
	return found || undefined;
}

function isTruthyEnv(value: string | undefined): boolean {
	if (!value) return false;
	switch (value.trim().toLowerCase()) {
		case "1":
		case "true":
		case "yes":
		case "on":
			return true;
		default:
			return false;
	}
}

function getTierTlsConfig(): { insecure: boolean; caCertPath?: string } {
	const insecure = isTruthyEnv(getConfiguredEnv("PI_SCRAPE_INSECURE_TLS"));
	const caCertPath = getConfiguredEnv("PI_SCRAPE_CA_CERT_PATH") || undefined;
	return { insecure, caCertPath };
}

function buildCurlTlsArgs(): string[] {
	const tls = getTierTlsConfig();
	if (tls.insecure) return ["-k"];
	if (tls.caCertPath) return ["--cacert", tls.caCertPath];
	return [];
}

function buildBaseCurlArgs(timeoutSeconds: number): string[] {
	return [
		"-L",
		"-sS",
		"--compressed",
		"--connect-timeout",
		String(CURL_CONNECT_TIMEOUT_SECONDS),
		"--max-time",
		String(timeoutSeconds),
		"--retry",
		String(CURL_RETRY_COUNT),
		"--retry-all-errors",
		"--retry-delay",
		"1",
		...buildCurlTlsArgs(),
	];
}

function getBrightDataApiToken(): string | undefined {
	return getConfiguredEnv("BRIGHTDATA_API_TOKEN") || getConfiguredEnv("API_TOKEN") || undefined;
}

function getBrightDataZone(): string {
	return getConfiguredEnv("BRIGHTDATA_WEB_UNLOCKER_ZONE") || getConfiguredEnv("WEB_UNLOCKER_ZONE") || "mcp_unlocker";
}

function buildTierPlan(
	url: string,
	tierPreference: TierPreference,
	allowPaidTier: boolean,
	brightDataConfigured: boolean,
): TierName[] {
	const paidTier = allowPaidTier && brightDataConfigured ? (["tier4"] as TierName[]) : [];
	switch (tierPreference) {
		case "tier1":
			return ["tier1", "tier2", "tier3", ...paidTier];
		case "tier2":
			return ["tier2", "tier3", ...paidTier];
		case "tier3":
			return ["tier3", ...paidTier];
		case "tier4":
			return paidTier;
		case "auto":
		default:
			return isLikelyJsHeavyUrl(url)
				? (["tier3", ...paidTier] as TierName[])
				: (["tier1", "tier2", "tier3", ...paidTier] as TierName[]);
	}
}

function isLikelyJsHeavyUrl(url: string): boolean {
	try {
		const parsed = new URL(url);
		const host = parsed.hostname.toLowerCase();
		return JS_HEAVY_HOST_SUFFIXES.some((suffix) => host.endsWith(suffix));
	} catch {
		return false;
	}
}

function formatTierName(tier: TierName): string {
	switch (tier) {
		case "tier1":
			return "Tier 1 · simple fetch";
		case "tier2":
			return "Tier 2 · curl + Chrome headers";
		case "tier3":
			return "Tier 3 · Playwright";
		case "tier4":
			return "Tier 4 · Bright Data";
	}
}

function formatExtraction(extraction: ExtractionStrategy): string {
	switch (extraction) {
		case "readability":
			return "Readability article extraction";
		case "body":
			return "HTML body to markdown";
		case "plain_text":
			return "Plain text passthrough";
		case "brightdata_markdown":
			return "Bright Data markdown";
	}
}

async function runTier(options: {
	tier: TierName;
	url: string;
	contentMode: ContentMode;
	extraWaitMs: number;
	signal: AbortSignal | undefined;
	chromiumPath: string | undefined;
	pi: ExtensionAPI;
}): Promise<ScrapeSuccess> {
	switch (options.tier) {
		case "tier1":
			return runTier1(options.url, options.contentMode, options.signal, options.pi);
		case "tier2":
			return runTier2(options.url, options.contentMode, options.signal, options.pi);
		case "tier3":
			return runTier3(
				options.url,
				options.contentMode,
				options.signal,
				options.extraWaitMs,
				options.chromiumPath,
			);
		case "tier4":
			return runTier4(options.url, options.signal, options.pi);
	}
}

async function runTier1(
	url: string,
	contentMode: ContentMode,
	signal: AbortSignal | undefined,
	pi: ExtensionAPI,
): Promise<ScrapeSuccess> {
	const args = [
		...buildBaseCurlArgs(Math.ceil(FETCH_TIMEOUT_MS / 1000)),
		"-A",
		CHROME_USER_AGENT,
		"-H",
		`Accept: ${SIMPLE_HEADERS.accept}`,
		"-H",
		`Accept-Language: ${SIMPLE_HEADERS["accept-language"]}`,
		"-w",
		`\n${CURL_META_SENTINEL}:%{http_code}\t%{url_effective}\t%{content_type}\n`,
		url,
	];
	const result = await pi.exec("curl", args, { signal });
	if (result.code !== 0) {
		throw new ScrapeAttemptError(result.stderr?.trim() || result.stdout?.trim() || "curl failed", {
			code: signal?.aborted ? "aborted" : "fetch_failed",
		});
	}
	const parsedCurl = parseCurlOutput(result.stdout || "");
	const parsed = extractContent(parsedCurl.body, parsedCurl.finalUrl || url, parsedCurl.contentType, contentMode);
	return assessScrape(parsed, parsedCurl.body, parsedCurl.statusCode, parsedCurl.finalUrl || url);
}

async function runTier2(
	url: string,
	contentMode: ContentMode,
	signal: AbortSignal | undefined,
	pi: ExtensionAPI,
): Promise<ScrapeSuccess> {
	const args = [
		...buildBaseCurlArgs(CURL_TIMEOUT_SECONDS),
		"-A",
		CHROME_USER_AGENT,
		...CURL_HEADERS.flatMap((header) => ["-H", header]),
		"-w",
		`\n${CURL_META_SENTINEL}:%{http_code}\t%{url_effective}\t%{content_type}\n`,
		url,
	];
	const result = await pi.exec("curl", args, { signal });
	if (result.code !== 0) {
		throw new ScrapeAttemptError(result.stderr?.trim() || result.stdout?.trim() || "curl failed", {
			code: "curl_failed",
		});
	}
	const parsedCurl = parseCurlOutput(result.stdout || "");
	const parsed = extractContent(parsedCurl.body, parsedCurl.finalUrl || url, parsedCurl.contentType, contentMode);
	return assessScrape(parsed, parsedCurl.body, parsedCurl.statusCode, parsedCurl.finalUrl || url);
}

function parseCurlOutput(output: string): {
	body: string;
	statusCode?: number;
	finalUrl?: string;
	contentType?: string;
} {
	const marker = `\n${CURL_META_SENTINEL}:`;
	const index = output.lastIndexOf(marker);
	if (index === -1) {
		throw new ScrapeAttemptError("Could not parse curl metadata", { code: "curl_parse_failed" });
	}
	const body = output.slice(0, index);
	const meta = output.slice(index + marker.length).trim();
	const [statusCodeRaw, finalUrl, contentType] = meta.split("\t");
	const statusCode = Number.parseInt(statusCodeRaw ?? "", 10);
	return {
		body,
		statusCode: Number.isFinite(statusCode) ? statusCode : undefined,
		finalUrl: finalUrl || undefined,
		contentType: contentType || undefined,
	};
}

function parseCurlStatusOutput(output: string): {
	body: string;
	statusCode?: number;
	contentType?: string;
} {
	const marker = `\n${CURL_META_SENTINEL}:`;
	const index = output.lastIndexOf(marker);
	if (index === -1) {
		throw new ScrapeAttemptError("Could not parse curl metadata", { code: "curl_parse_failed" });
	}
	const body = output.slice(0, index);
	const meta = output.slice(index + marker.length).trim();
	const [statusCodeRaw, contentType] = meta.split("\t");
	const statusCode = Number.parseInt(statusCodeRaw ?? "", 10);
	return {
		body,
		statusCode: Number.isFinite(statusCode) ? statusCode : undefined,
		contentType: contentType || undefined,
	};
}

async function runTier3(
	url: string,
	contentMode: ContentMode,
	signal: AbortSignal | undefined,
	extraWaitMs: number,
	chromiumPath: string | undefined,
): Promise<ScrapeSuccess> {
	if (!chromiumPath) {
		throw new ScrapeAttemptError(
			"Chromium was not found. Set PI_SCRAPE_CHROMIUM_PATH if auto-detection fails.",
			{ code: "no_browser" },
		);
	}

	let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
	const abortListener = () => {
		void browser?.close().catch(() => undefined);
	};
	signal?.addEventListener("abort", abortListener);

	try {
		browser = await chromium.launch({
			headless: true,
			executablePath: chromiumPath,
			args: ["--no-sandbox", "--disable-dev-shm-usage"],
		});
		const context = await browser.newContext({
			userAgent: CHROME_USER_AGENT,
			locale: "en-US",
			viewport: { width: 1440, height: 900 },
			extraHTTPHeaders: {
				accept: SIMPLE_HEADERS.accept,
				"accept-language": SIMPLE_HEADERS["accept-language"],
			},
		});
		const page = await context.newPage();
		throwIfAborted(signal);
		const response = await page.goto(url, {
			waitUntil: "domcontentloaded",
			timeout: PLAYWRIGHT_GOTO_TIMEOUT_MS,
		});
		throwIfAborted(signal);
		await page.waitForLoadState("networkidle", {
			timeout: PLAYWRIGHT_NETWORK_IDLE_TIMEOUT_MS,
		}).catch(() => undefined);
		if (extraWaitMs > 0) await page.waitForTimeout(extraWaitMs);
		throwIfAborted(signal);
		const html = await page.content();
		const finalUrl = page.url() || url;
		const title = await page.title().catch(() => undefined);
		const parsed = extractContent(html, finalUrl, "text/html", contentMode, title);
		return assessScrape(parsed, html, response?.status(), finalUrl);
	} catch (error) {
		if (error instanceof ScrapeAttemptError) throw error;
		throw new ScrapeAttemptError(error instanceof Error ? error.message : String(error), {
			code: signal?.aborted ? "aborted" : "playwright_failed",
		});
	} finally {
		signal?.removeEventListener("abort", abortListener);
		await browser?.close().catch(() => undefined);
	}
}

async function runTier4(
	url: string,
	signal: AbortSignal | undefined,
	pi: ExtensionAPI,
): Promise<ScrapeSuccess> {
	const apiToken = getBrightDataApiToken();
	if (!apiToken) {
		throw new ScrapeAttemptError(
			"Bright Data API token is not configured (BRIGHTDATA_API_TOKEN or API_TOKEN).",
			{ code: "no_brightdata" },
		);
	}

	const payload = JSON.stringify({
		url,
		zone: getBrightDataZone(),
		format: "raw",
		data_format: "markdown",
	});
	const result = await pi.exec(
		"curl",
		[
			...buildBaseCurlArgs(Math.ceil(BRIGHTDATA_TIMEOUT_MS / 1000)),
			"-X",
			"POST",
			BRIGHTDATA_ENDPOINT,
			"-H",
			`Authorization: Bearer ${apiToken}`,
			"-H",
			"Content-Type: application/json",
			"-H",
			"User-Agent: pi-web-scrape-extension/0.1.0",
			"-H",
			`X-Mcp-Tool: ${TOOL_NAME}`,
			"--data-raw",
			payload,
			"-w",
			`\n${CURL_META_SENTINEL}:%{http_code}\t%{content_type}\n`,
		],
		{ signal },
	);
	if (result.code !== 0) {
		throw new ScrapeAttemptError(result.stderr?.trim() || result.stdout?.trim() || "Bright Data curl failed", {
			code: signal?.aborted ? "aborted" : "brightdata_failed",
		});
	}

	const response = parseCurlStatusOutput(result.stdout || "");
	const markdown = normalizeMarkdown(response.body);
	if (!response.statusCode || response.statusCode >= 400) {
		throw new ScrapeAttemptError(
			`Bright Data HTTP ${response.statusCode ?? "?"}: ${markdown.slice(0, 240) || "request failed"}`,
			{
				code: "brightdata_failed",
				statusCode: response.statusCode,
				finalUrl: url,
				chars: stripText(markdown).length,
				extraction: "brightdata_markdown",
			},
		);
	}
	const title = markdown.match(/^#\s+(.+)$/m)?.[1]?.trim();
	const textLength = stripText(markdown).length;
	if (!markdown || textLength < 60) {
		throw new ScrapeAttemptError("Bright Data returned too little content.", {
			code: "content_too_small",
			statusCode: response.statusCode,
			finalUrl: url,
			chars: textLength,
			extraction: "brightdata_markdown",
		});
	}
	if (looksBlocked(title, markdown, markdown)) {
		throw new ScrapeAttemptError("Bright Data response still looks blocked or challenge-based.", {
			code: "blocked",
			statusCode: response.statusCode,
			finalUrl: url,
			chars: textLength,
			extraction: "brightdata_markdown",
		});
	}
	return {
		title,
		finalUrl: url,
		statusCode: response.statusCode,
		markdown,
		textLength,
		extraction: "brightdata_markdown",
	};
}

function throwIfAborted(signal: AbortSignal | undefined) {
	if (!signal?.aborted) return;
	throw signal.reason instanceof Error ? signal.reason : new Error("Aborted");
}

function extractContent(
	payload: string,
	sourceUrl: string,
	contentType: string | null | undefined,
	contentMode: ContentMode,
	preferredTitle?: string,
): {
	title?: string;
	markdown: string;
	textLength: number;
	extraction: ExtractionStrategy;
} {
	const trimmedPayload = payload.trim();
	if (!trimmedPayload) {
		return {
			title: preferredTitle,
			markdown: "",
			textLength: 0,
			extraction: "plain_text",
		};
	}

	if (isProbablyPlainText(contentType, trimmedPayload)) {
		const markdown = normalizeMarkdown(trimmedPayload);
		return {
			title: preferredTitle,
			markdown,
			textLength: stripText(markdown).length,
			extraction: "plain_text",
		};
	}

	return extractHtmlContent(trimmedPayload, sourceUrl, contentMode, preferredTitle);
}

function isProbablyPlainText(contentType: string | null | undefined, payload: string): boolean {
	const type = (contentType || "").toLowerCase();
	if (type.includes("text/plain") || type.includes("application/json") || type.includes("application/xml")) {
		return true;
	}
	return !looksLikeHtml(payload);
}

function looksLikeHtml(payload: string): boolean {
	return /<!doctype html|<html[\s>]|<body[\s>]|<head[\s>]/i.test(payload);
}

function extractHtmlContent(
	html: string,
	sourceUrl: string,
	contentMode: ContentMode,
	preferredTitle?: string,
): {
	title?: string;
	markdown: string;
	textLength: number;
	extraction: ExtractionStrategy;
} {
	if (contentMode === "article") {
		const readabilityDom = new JSDOM(html, { url: sourceUrl });
		const article = new Readability(readabilityDom.window.document).parse();
		if (article?.content && article.textContent?.trim()) {
			const markdown = normalizeMarkdown(makeTurndownService().turndown(article.content));
			if (markdown.trim()) {
				return {
					title: preferredTitle || article.title || undefined,
					markdown,
					textLength: article.textContent.trim().length,
					extraction: "readability",
				};
			}
		}
	}

	const dom = new JSDOM(html, { url: sourceUrl });
	const document = dom.window.document;
	sanitizeDocument(document, contentMode);
	const bodyText = document.body?.textContent?.replace(/\s+/g, " ").trim() ?? "";
	const bodyHtml = document.body?.innerHTML?.trim() || document.documentElement.innerHTML.trim();
	if (bodyHtml) {
		const markdown = normalizeMarkdown(makeTurndownService().turndown(bodyHtml));
		if (markdown.trim()) {
			return {
				title: preferredTitle || document.title || undefined,
				markdown,
				textLength: bodyText.length,
				extraction: "body",
			};
		}
	}

	const markdown = normalizeMarkdown(bodyText);
	return {
		title: preferredTitle || document.title || undefined,
		markdown,
		textLength: bodyText.length,
		extraction: "plain_text",
	};
}

function sanitizeDocument(document: Document, contentMode: ContentMode) {
	const selectors = [
		"script",
		"style",
		"noscript",
		"svg",
		"canvas",
		"iframe",
		"template",
		"meta",
		"link",
		"source",
		"picture",
		"video",
		"audio",
		"object",
		"embed",
	] as const;
	for (const selector of selectors) {
		for (const element of Array.from(document.querySelectorAll(selector))) element.remove();
	}
	if (contentMode === "article") {
		for (const element of Array.from(document.querySelectorAll("nav, header, footer, aside, form, button, dialog"))) {
			element.remove();
		}
	}
}

function makeTurndownService(): TurndownService {
	const service = new TurndownService({
		headingStyle: "atx",
		codeBlockStyle: "fenced",
		bulletListMarker: "-",
		linkStyle: "inlined",
		emDelimiter: "_",
	});
	service.use(gfm);
	return service;
}

function normalizeMarkdown(markdown: string): string {
	return markdown.replace(/\r\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
}

function stripText(markdown: string): string {
	return markdown
		.replace(/```[\s\S]*?```/g, " ")
		.replace(/`[^`]*`/g, " ")
		.replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
		.replace(/\[[^\]]*\]\([^)]*\)/g, " ")
		.replace(/[>#*_~-]/g, " ")
		.replace(/\s+/g, " ")
		.trim();
}

function assessScrape(
	parsed: { title?: string; markdown: string; textLength: number; extraction: ExtractionStrategy },
	rawContent: string,
	statusCode: number | undefined,
	finalUrl: string,
): ScrapeSuccess {
	const textLength = parsed.textLength || stripText(parsed.markdown).length;
	if (statusCode && statusCode >= 400 && textLength < 500) {
		throw new ScrapeAttemptError(`HTTP ${statusCode}`, {
			code: `http_${statusCode}`,
			statusCode,
			finalUrl,
			chars: textLength,
			extraction: parsed.extraction,
		});
	}
	if (!parsed.markdown.trim()) {
		throw new ScrapeAttemptError("No extractable content found.", {
			code: "empty_content",
			statusCode,
			finalUrl,
			chars: textLength,
			extraction: parsed.extraction,
		});
	}
	if (looksBlocked(parsed.title, parsed.markdown, rawContent)) {
		throw new ScrapeAttemptError("Blocked by anti-bot or CAPTCHA page.", {
			code: "blocked",
			statusCode,
			finalUrl,
			chars: textLength,
			extraction: parsed.extraction,
		});
	}
	if (textLength < 60) {
		if (looksLikeJsShell(rawContent)) {
			throw new ScrapeAttemptError("Page looks JavaScript-rendered and needs a browser.", {
				code: "javascript_required",
				statusCode,
				finalUrl,
				chars: textLength,
				extraction: parsed.extraction,
			});
		}
		throw new ScrapeAttemptError("Extracted content was too small to trust.", {
			code: "content_too_small",
			statusCode,
			finalUrl,
			chars: textLength,
			extraction: parsed.extraction,
		});
	}
	return {
		title: parsed.title,
		finalUrl,
		statusCode,
		markdown: parsed.markdown,
		textLength,
		extraction: parsed.extraction,
	};
}

function looksBlocked(title: string | undefined, markdown: string, rawContent: string): boolean {
	const sample = `${title || ""}\n${markdown}\n${rawContent}`.slice(0, 4_000);
	return BLOCK_PATTERNS.some((pattern) => pattern.test(sample));
}

function looksLikeJsShell(rawContent: string): boolean {
	return JS_HEAVY_HTML_PATTERNS.some((pattern) => pattern.test(rawContent));
}

function condenseWhitespace(value: string): string {
	return value.replace(/\s*\n\s*/g, " ").replace(/\s{2,}/g, " ").trim();
}

function formatNestedErrorMessage(error: unknown): string {
	if (error instanceof Error) {
		const cause = (error as Error & { cause?: unknown }).cause;
		if (cause instanceof Error && cause.message) {
			return condenseWhitespace(`${error.message}: ${cause.message}`);
		}
		return condenseWhitespace(error.message);
	}
	return condenseWhitespace(String(error));
}

function formatAttemptError(error: unknown): {
	message: string;
	statusCode?: number;
	finalUrl?: string;
	chars?: number;
	extraction?: ExtractionStrategy;
} {
	if (error instanceof ScrapeAttemptError) {
		return {
			message: condenseWhitespace(error.message),
			statusCode: error.statusCode,
			finalUrl: error.finalUrl,
			chars: error.chars,
			extraction: error.extraction,
		};
	}
	if (error instanceof Error) {
		return { message: condenseWhitespace(error.message) };
	}
	return { message: condenseWhitespace(String(error)) };
}

function renderSuccessOutput(options: {
	url: string;
	result: ScrapeSuccess;
	tierUsed: TierName;
	attempts: ScrapeAttemptSummary[];
}): string {
	const truncated = truncateTail(options.result.markdown, {
		maxLines: DEFAULT_MAX_LINES,
		maxBytes: DEFAULT_MAX_BYTES,
	});
	const lines = [
		options.result.title ? `Title: ${options.result.title}` : undefined,
		`Source: ${options.result.finalUrl}`,
		`Requested URL: ${options.url}`,
		`Tier used: ${formatTierName(options.tierUsed)}`,
		`Extraction: ${formatExtraction(options.result.extraction)}`,
		options.result.statusCode ? `HTTP status: ${options.result.statusCode}` : undefined,
		"Attempts:",
		...options.attempts.map((attempt) => {
			const parts = [
				`${attempt.ok ? "-" : "-"} ${formatTierName(attempt.tier)}`,
				attempt.ok ? "success" : `failed: ${attempt.reason ?? "unknown error"}`,
				attempt.statusCode ? `HTTP ${attempt.statusCode}` : undefined,
				typeof attempt.chars === "number" ? `${attempt.chars} chars` : undefined,
				attempt.extraction ? formatExtraction(attempt.extraction) : undefined,
				`${attempt.ms}ms`,
			];
			return parts.filter(Boolean).join(" • ");
		}),
		"",
		"---",
		"",
		truncated.content,
	];
	if (truncated.truncated) {
		lines.push(
			"",
			`[content truncated: ${truncated.outputLines} of ${truncated.totalLines} lines (${formatSize(
				truncated.outputBytes,
			)} of ${formatSize(truncated.totalBytes)})]`,
		);
	}
	return lines.filter((line): line is string => line !== undefined).join("\n");
}

function renderFailureOutput(options: {
	url: string;
	attempts: ScrapeAttemptSummary[];
	allowPaidTier: boolean;
	brightDataConfigured: boolean;
	chromiumPath: string | undefined;
}): string {
	const lines = [
		`Unable to scrape ${options.url} after ${options.attempts.length} attempt${
			options.attempts.length === 1 ? "" : "s"
		}.`,
		"",
		"Attempts:",
		...options.attempts.map((attempt) => {
			const parts = [
				`- ${formatTierName(attempt.tier)}`,
				attempt.reason ?? "unknown error",
				attempt.statusCode ? `HTTP ${attempt.statusCode}` : undefined,
				typeof attempt.chars === "number" ? `${attempt.chars} chars` : undefined,
				`${attempt.ms}ms`,
			];
			return parts.filter(Boolean).join(" • ");
		}),
	];
	if (!options.chromiumPath) {
		lines.push(
			"",
			"Tier 3 note: Chromium was not auto-detected. Set PI_SCRAPE_CHROMIUM_PATH if Playwright should use a custom browser path.",
		);
	}
	if (options.allowPaidTier && !options.brightDataConfigured) {
		lines.push(
			"",
			"Tier 4 note: Bright Data was skipped because BRIGHTDATA_API_TOKEN/API_TOKEN is not configured.",
		);
	}
	return lines.join("\n");
}
