import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import {
	DEFAULT_MAX_BYTES,
	DEFAULT_MAX_LINES,
	formatSize,
	truncateTail,
} from "@mariozechner/pi-coding-agent";
import { StringEnum } from "@mariozechner/pi-ai";
import { Type } from "@sinclair/typebox";
import { existsSync, readFileSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";

const TOOL_NAME = "web-search";
const BRAVE_WEB_SEARCH_ENDPOINT = "https://api.search.brave.com/res/v1/web/search";
const USER_AGENT = "pi-web-search-extension/0.2.0";
const DEFAULT_COUNT = 8;
const DEFAULT_TIMEOUT_MS = 15_000;
const MAX_RETRY_DELAY_MS = 5_000;
const MAX_RENDERED_RESULTS_PER_SECTION = 5;
const MAX_EXTRA_SNIPPETS_PER_RESULT = 3;
const SAFE_SEARCH_VALUES = ["off", "moderate", "strict"] as const;
const RESULT_FILTER_VALUES = [
	"discussions",
	"faq",
	"infobox",
	"locations",
	"news",
	"videos",
	"web",
] as const;
const SECTION_LABELS = {
	web: "Web",
	news: "News",
	videos: "Videos",
	locations: "Locations",
	discussions: "Discussions",
	faq: "FAQ",
} as const;
const DEFAULT_SECTION_ORDER = ["web", "news", "videos", "locations", "discussions", "faq"] as const;
const SEARCH_RESULT_TYPE_SET = new Set<string>(RESULT_FILTER_VALUES);
const PI_AGENT_DIR = process.env.PI_CODING_AGENT_DIR?.trim() || join(homedir(), ".pi", "agent");
const EXTENSION_DIR = join(PI_AGENT_DIR, "extensions", "web-search");
const EXTENSION_ENV_PATH = join(EXTENSION_DIR, ".env");

type JsonRecord = Record<string, unknown>;
type SearchSectionKey = keyof typeof SECTION_LABELS;
type SearchResultType = (typeof RESULT_FILTER_VALUES)[number];
type MixedLane = "main" | "top" | "side";

interface GenericResultItem {
	title?: string;
	url?: string;
	description?: string;
	age?: string;
	extraSnippets: string[];
	meta: string[];
}

interface ParsedInfobox {
	title?: string;
	url?: string;
	description?: string;
	attributes: Array<{ label: string; value: string }>;
}

interface MixedReference {
	section: SearchSectionKey;
	index: number;
	lane: MixedLane;
}

interface RankedResult {
	section: SearchSectionKey;
	item: GenericResultItem;
	lane?: MixedLane;
}

interface ParsedResponse {
	responseType?: string;
	queryOriginal?: string;
	queryAltered?: string;
	moreResultsAvailable?: boolean;
	sections: Record<SearchSectionKey, GenericResultItem[]>;
	infobox?: ParsedInfobox;
	mixedReferences: MixedReference[];
}

interface RequestConfig {
	query: string;
	count: number;
	offset?: number;
	country?: string;
	searchLanguage?: string;
	uiLanguage?: string;
	safeSearch?: string;
	freshness?: string;
	resultTypes?: SearchResultType[];
	extraSnippets?: boolean;
	spellcheck?: boolean;
	textDecorations?: boolean;
}

interface BraveCredential {
	key?: string;
	source?: string;
}

interface RateLimitInfo {
	limit?: number;
	remaining?: number;
	resetSeconds?: number;
	retryAfterSeconds?: number;
}

interface FetchResult {
	response: Response;
	rawBody: string;
	payload?: JsonRecord;
	parseError?: string;
	rateLimit: RateLimitInfo;
	attempts: number;
}

const WebSearchParams = Type.Object({
	query: Type.String({
		minLength: 1,
		description: "Search query for the public web",
	}),
	count: Type.Optional(
		Type.Integer({
			minimum: 1,
			maximum: 20,
			description: "Maximum number of web results to request. Brave caps this at 20. Defaults to 8.",
		}),
	),
	offset: Type.Optional(
		Type.Integer({
			minimum: 0,
			maximum: 9,
			description: "Zero-based page offset. Brave caps this at 9.",
		}),
	),
	country: Type.Optional(
		Type.String({
			minLength: 2,
			maxLength: 2,
			description: "Two-letter country code such as US, GB, or DE.",
		}),
	),
	searchLanguage: Type.Optional(
		Type.String({
			minLength: 2,
			description: "Preferred result language such as en, de, or es.",
		}),
	),
	uiLanguage: Type.Optional(
		Type.String({
			minLength: 2,
			description: "Preferred UI language for metadata such as en-US.",
		}),
	),
	safeSearch: Type.Optional(StringEnum(SAFE_SEARCH_VALUES)),
	freshness: Type.Optional(
		Type.String({
			description: "Freshness window: pd, pw, pm, py, or a custom range like 2026-04-01to2026-04-13.",
		}),
	),
	resultTypes: Type.Optional(
		Type.Array(StringEnum(RESULT_FILTER_VALUES), {
			uniqueItems: true,
			minItems: 1,
			description:
				"Subset of Brave result types to include. Leave unset for Brave's normal mixed response.",
		}),
	),
	extraSnippets: Type.Optional(
		Type.Boolean({
			description: "Include additional snippets when Brave provides them.",
		}),
	),
	spellcheck: Type.Optional(
		Type.Boolean({
			description: "Allow Brave to rewrite misspelled queries. Defaults to true.",
		}),
	),
	textDecorations: Type.Optional(
		Type.Boolean({
			description: "Include Brave's snippet decoration markers. Defaults to false for cleaner output.",
		}),
	),
});

export default function webSearchExtension(pi: ExtensionAPI) {
	pi.registerTool({
		name: TOOL_NAME,
		label: "Web Search",
		description:
			"Search the public web via Brave Search API. Returns ranked results with titles, URLs, snippets, and optional news, videos, locations, discussions, FAQ, and infobox data.",
		promptSnippet: "Search the public web via Brave Search API for current information, docs, and pages.",
		promptGuidelines: [
			"Use this tool when the user needs current or external web information instead of relying on model memory.",
			"Prefer narrow, specific queries and search operators when the user is looking for documentation, releases, or a particular site.",
			"When the user only wants ranked web pages, pass resultTypes: [\"web\"] to keep output focused.",
			"Use web-scrape on promising result URLs when the user needs the actual page contents, not just search snippets.",
		],
		parameters: WebSearchParams,
		prepareArguments(args) {
			if (!args || typeof args !== "object" || Array.isArray(args)) return args;
			const input = args as Record<string, unknown>;
			const next: Record<string, unknown> = { ...input };

			applyAlias(next, input, "query", "q");
			applyAlias(next, input, "searchLanguage", "search_lang");
			applyAlias(next, input, "uiLanguage", "ui_lang");
			applyAlias(next, input, "safeSearch", "safesearch");
			applyAlias(next, input, "resultTypes", "result_filter", normalizeResultTypesAlias);
			applyAlias(next, input, "extraSnippets", "extra_snippets", coerceBooleanMaybe);
			applyAlias(next, input, "textDecorations", "text_decorations", coerceBooleanMaybe);

			next.count = coerceIntegerMaybe(next.count);
			next.offset = coerceIntegerMaybe(next.offset);
			next.spellcheck = coerceBooleanMaybe(next.spellcheck);
			next.extraSnippets = coerceBooleanMaybe(next.extraSnippets);
			next.textDecorations = coerceBooleanMaybe(next.textDecorations);
			next.resultTypes = normalizeResultTypesAlias(next.resultTypes);

			return next;
		},
		async execute(_toolCallId, params, signal) {
			const credential = resolveBraveCredential();
			if (!credential.key) {
				return {
					content: [
						{
							type: "text",
							text: [
								"Brave web search is not configured.",
								`Set BRAVE_SEARCH_API_KEY, BRAVE_API_KEY, or BRAVE_SEARCH_SUBSCRIPTION_TOKEN in your environment or in ${EXTENSION_ENV_PATH}.`,
								"Then run /reload and try again.",
							].join("\n"),
						},
					],
					details: {
						configured: false,
						envPath: EXTENSION_ENV_PATH,
					},
					isError: true,
				};
			}

			const requestConfig = normalizeRequest(params as Partial<RequestConfig>);
			if (!requestConfig.query) {
				return {
					content: [{ type: "text", text: "Brave web search requires a non-empty query." }],
					details: {
						configured: true,
						credentialSource: credential.source,
					},
					isError: true,
				};
			}

			const requestUrl = buildRequestUrl(requestConfig);
			try {
				const result = await fetchBraveSearch(requestUrl, credential.key, signal);
				if (!result.response.ok) {
					return {
						content: [
							{
								type: "text",
								text: formatHttpError(result.response.status, result.payload, result.rawBody, result.rateLimit),
							},
						],
						details: {
							configured: true,
							credentialSource: credential.source,
							requestUrl,
							status: result.response.status,
							rateLimit: result.rateLimit,
							attempts: result.attempts,
						},
						isError: true,
					};
				}

				if (!result.payload) {
					return {
						content: [
							{
								type: "text",
								text: `Brave web search returned an unreadable response: ${result.parseError ?? previewText(result.rawBody)}`,
							},
						],
						details: {
							configured: true,
							credentialSource: credential.source,
							requestUrl,
							rateLimit: result.rateLimit,
							attempts: result.attempts,
						},
						isError: true,
					};
				}

				const parsed = parseSearchResponse(result.payload);
				const hasRenderableResults =
					Boolean(parsed.infobox) ||
					Object.values(parsed.sections).some((items) => items.length > 0);
				const validEnvelope =
					parsed.responseType === "search" ||
					Boolean(parsed.queryOriginal) ||
					Boolean(parsed.queryAltered) ||
					hasRenderableResults;
				if (!validEnvelope) {
					return {
						content: [
							{
								type: "text",
								text: "Brave web search returned a response that did not match the expected search schema.",
							},
						],
						details: {
							configured: true,
							credentialSource: credential.source,
							requestUrl,
							responseType: parsed.responseType,
							rateLimit: result.rateLimit,
							attempts: result.attempts,
						},
						isError: true,
					};
				}

				const rendered = renderSearchOutput(requestConfig, parsed);
				const truncation = truncateTail(rendered, {
					maxLines: DEFAULT_MAX_LINES,
					maxBytes: DEFAULT_MAX_BYTES,
				});

				let text = truncation.content;
				let fullOutputPath: string | undefined;
				if (truncation.truncated) {
					fullOutputPath = await writeFullOutput(rendered);
					const truncationSummary = [
						`[output truncated: ${truncation.outputLines} of ${truncation.totalLines} lines`,
						`(${formatSize(truncation.outputBytes)} of ${formatSize(truncation.totalBytes)})`,
						fullOutputPath ? `full output: ${fullOutputPath}]` : "]",
					].join(" ");
					text = text ? `${text}\n\n${truncationSummary}` : truncationSummary;
				}

				const topResult = getTopResult(parsed);
				const sectionCounts = Object.fromEntries(
					DEFAULT_SECTION_ORDER.map((key) => [key, parsed.sections[key].length]),
				);

				return {
					content: [{ type: "text", text }],
					details: {
						configured: true,
						credentialSource: credential.source,
						requestUrl,
						queryOriginal: parsed.queryOriginal,
						queryAltered: parsed.queryAltered,
						moreResultsAvailable: parsed.moreResultsAvailable,
						sectionCounts,
						hasInfobox: Boolean(parsed.infobox),
						hasRenderableResults,
						topResultUrl: topResult?.item.url,
						topResultSection: topResult?.section,
						rateLimit: result.rateLimit,
						attempts: result.attempts,
						truncated: truncation.truncated,
						fullOutputPath,
					},
					isError: false,
				};
			} catch (error) {
				return {
					content: [
						{
							type: "text",
							text: `Brave web search failed: ${formatRuntimeError(error)}`,
						},
					],
					details: {
						configured: true,
						credentialSource: credential.source,
						requestUrl,
					},
					isError: true,
				};
			}
		},
	});
}

function applyAlias(
	target: Record<string, unknown>,
	source: Record<string, unknown>,
	canonicalKey: string,
	aliasKey: string,
	transform?: (value: unknown) => unknown,
) {
	if (target[canonicalKey] !== undefined || source[aliasKey] === undefined) return;
	target[canonicalKey] = transform ? transform(source[aliasKey]) : source[aliasKey];
}

function loadExtensionEnv(): Record<string, string> {
	if (!existsSync(EXTENSION_ENV_PATH)) return {};

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
	return values;
}

function resolveBraveCredential(): BraveCredential {
	const envNames = [
		"BRAVE_SEARCH_API_KEY",
		"BRAVE_API_KEY",
		"BRAVE_SEARCH_SUBSCRIPTION_TOKEN",
	] as const;

	for (const name of envNames) {
		const runtimeValue = process.env[name]?.trim();
		if (runtimeValue) return { key: runtimeValue, source: `env:${name}` };
	}

	const fileValues = loadExtensionEnv();
	for (const name of envNames) {
		const fileValue = fileValues[name]?.trim();
		if (fileValue) return { key: fileValue, source: `${EXTENSION_ENV_PATH}:${name}` };
	}

	return {};
}

function normalizeRequest(input: Partial<RequestConfig>): RequestConfig {
	return {
		query: input.query?.trim() || "",
		count: clampInteger(input.count ?? DEFAULT_COUNT, 1, 20),
		offset: typeof input.offset === "number" ? clampInteger(input.offset, 0, 9) : undefined,
		country: input.country?.trim().toUpperCase() || undefined,
		searchLanguage: input.searchLanguage?.trim() || undefined,
		uiLanguage: input.uiLanguage?.trim() || undefined,
		safeSearch: input.safeSearch ?? "moderate",
		freshness: input.freshness?.trim() || undefined,
		resultTypes: dedupeResultTypes(input.resultTypes),
		extraSnippets: input.extraSnippets,
		spellcheck: input.spellcheck ?? true,
		textDecorations: input.textDecorations ?? false,
	};
}

function clampInteger(value: number, min: number, max: number): number {
	return Math.max(min, Math.min(max, Math.trunc(value)));
}

function dedupeResultTypes(value: SearchResultType[] | undefined): SearchResultType[] | undefined {
	if (!value || value.length === 0) return undefined;
	return Array.from(new Set(value)).filter(isSearchResultType);
}

function isSearchResultType(value: unknown): value is SearchResultType {
	return typeof value === "string" && SEARCH_RESULT_TYPE_SET.has(value);
}

function buildRequestUrl(config: RequestConfig): string {
	const url = new URL(BRAVE_WEB_SEARCH_ENDPOINT);
	url.searchParams.set("q", config.query);
	url.searchParams.set("count", String(config.count));
	url.searchParams.set("spellcheck", String(config.spellcheck ?? true));
	url.searchParams.set("text_decorations", String(config.textDecorations ?? false));
	if (typeof config.offset === "number") url.searchParams.set("offset", String(config.offset));
	if (config.country) url.searchParams.set("country", config.country);
	if (config.searchLanguage) url.searchParams.set("search_lang", config.searchLanguage);
	if (config.uiLanguage) url.searchParams.set("ui_lang", config.uiLanguage);
	if (config.safeSearch) url.searchParams.set("safesearch", config.safeSearch);
	if (config.freshness) url.searchParams.set("freshness", config.freshness);
	if (typeof config.extraSnippets === "boolean") {
		url.searchParams.set("extra_snippets", String(config.extraSnippets));
	}
	if (config.resultTypes && config.resultTypes.length > 0) {
		url.searchParams.set("result_filter", config.resultTypes.join(","));
	}
	return url.toString();
}

async function fetchBraveSearch(
	requestUrl: string,
	apiKey: string,
	parentSignal: AbortSignal | undefined,
): Promise<FetchResult> {
	const request = createAbortableRequest(parentSignal, DEFAULT_TIMEOUT_MS);
	try {
		let attempts = 0;
		while (true) {
			attempts += 1;
			const response = await fetch(requestUrl, {
				method: "GET",
				headers: {
					Accept: "application/json",
					"X-Subscription-Token": apiKey,
					"User-Agent": USER_AGENT,
				},
				signal: request.signal,
			});
			const rawBody = await response.text();
			const rateLimit = extractRateLimitInfo(response.headers);
			const parsedBody = parseJsonBody(rawBody);

			if (response.status === 429 && attempts === 1) {
				const retryDelayMs = getRetryDelayMs(response.headers, rateLimit);
				if (retryDelayMs !== undefined && retryDelayMs <= MAX_RETRY_DELAY_MS) {
					await sleep(retryDelayMs, request.signal);
					continue;
				}
			}

			return {
				response,
				rawBody,
				payload: parsedBody.value,
				parseError: parsedBody.error,
				rateLimit,
				attempts,
			};
		}
	} finally {
		request.cleanup();
	}
}

function createAbortableRequest(parentSignal: AbortSignal | undefined, timeoutMs: number) {
	const controller = new AbortController();
	let timeoutId: ReturnType<typeof setTimeout> | undefined = setTimeout(() => {
		abort(new Error(`Request timed out after ${timeoutMs}ms`));
	}, timeoutMs);

	const abort = (reason?: unknown) => {
		if (timeoutId) {
			clearTimeout(timeoutId);
			timeoutId = undefined;
		}
		if (!controller.signal.aborted) controller.abort(reason);
	};

	const onParentAbort = () => {
		abort(parentSignal?.reason instanceof Error ? parentSignal.reason : new Error("Aborted"));
	};

	if (parentSignal) {
		if (parentSignal.aborted) onParentAbort();
		else parentSignal.addEventListener("abort", onParentAbort, { once: true });
	}

	return {
		signal: controller.signal,
		cleanup() {
			if (timeoutId) {
				clearTimeout(timeoutId);
				timeoutId = undefined;
			}
			parentSignal?.removeEventListener("abort", onParentAbort);
		},
	};
}

function parseJsonBody(text: string): { value?: JsonRecord; error?: string } {
	const trimmed = text.trim();
	if (!trimmed) return { error: "Brave returned an empty response body." };
	try {
		const parsed = JSON.parse(trimmed) as unknown;
		const record = asRecord(parsed);
		if (!record) return { error: "Brave returned JSON, but it was not an object." };
		return { value: record };
	} catch (error) {
		return {
			error: error instanceof Error ? error.message : "Failed to parse Brave response as JSON.",
		};
	}
}

function extractRateLimitInfo(headers: Headers): RateLimitInfo {
	return {
		limit: parseLeadingInteger(headers.get("x-ratelimit-limit")),
		remaining: parseLeadingInteger(headers.get("x-ratelimit-remaining")),
		resetSeconds: parseLeadingInteger(headers.get("x-ratelimit-reset")),
		retryAfterSeconds: parseRetryAfterSeconds(headers.get("retry-after")),
	};
}

function parseLeadingInteger(value: string | null): number | undefined {
	if (!value) return undefined;
	const first = value.split(",")[0]?.trim();
	if (!first) return undefined;
	const parsed = Number.parseInt(first, 10);
	return Number.isFinite(parsed) ? parsed : undefined;
}

function parseRetryAfterSeconds(value: string | null): number | undefined {
	if (!value) return undefined;
	const asInteger = Number.parseInt(value, 10);
	if (Number.isFinite(asInteger)) return Math.max(0, asInteger);
	const asDate = Date.parse(value);
	if (Number.isNaN(asDate)) return undefined;
	return Math.max(0, Math.ceil((asDate - Date.now()) / 1000));
}

function getRetryDelayMs(headers: Headers, rateLimit: RateLimitInfo): number | undefined {
	const retryAfterSeconds =
		parseRetryAfterSeconds(headers.get("retry-after")) ?? rateLimit.retryAfterSeconds ?? rateLimit.resetSeconds;
	if (retryAfterSeconds === undefined) return undefined;
	return Math.max(250, retryAfterSeconds * 1_000);
}

async function sleep(ms: number, signal: AbortSignal | undefined): Promise<void> {
	if (!signal) {
		await new Promise((resolve) => setTimeout(resolve, ms));
		return;
	}
	if (signal.aborted) throw signal.reason instanceof Error ? signal.reason : new Error("Aborted");
	await new Promise<void>((resolve, reject) => {
		const timeoutId = setTimeout(() => {
			signal.removeEventListener("abort", onAbort);
			resolve();
		}, ms);
		const onAbort = () => {
			clearTimeout(timeoutId);
			signal.removeEventListener("abort", onAbort);
			reject(signal.reason instanceof Error ? signal.reason : new Error("Aborted"));
		};
		signal.addEventListener("abort", onAbort, { once: true });
	});
}

function parseSearchResponse(payload: JsonRecord): ParsedResponse {
	const query = asRecord(payload.query);
	const sections = createEmptySections();
	for (const section of DEFAULT_SECTION_ORDER) {
		sections[section] = extractSectionResults(payload, section);
	}

	return {
		responseType: firstString(payload.type),
		queryOriginal: firstString(query?.original, query?.query),
		queryAltered: firstString(query?.altered),
		moreResultsAvailable:
			typeof query?.more_results_available === "boolean" ? query.more_results_available : undefined,
		sections,
		infobox: extractInfobox(payload.infobox),
		mixedReferences: extractMixedReferences(payload),
	};
}

function createEmptySections(): Record<SearchSectionKey, GenericResultItem[]> {
	return Object.fromEntries(
		DEFAULT_SECTION_ORDER.map((section) => [section, [] as GenericResultItem[]]),
	) as Record<SearchSectionKey, GenericResultItem[]>;
}

function extractSectionResults(payload: JsonRecord, key: SearchSectionKey): GenericResultItem[] {
	const section = asRecord(payload[key]);
	const rawResults = Array.isArray(section?.results)
		? section.results
		: Array.isArray(payload[key])
			? (payload[key] as unknown[])
			: [];

	return rawResults
		.map((result) => extractGenericResult(asRecord(result)))
		.filter((result): result is GenericResultItem =>
			Boolean(result && (result.title || result.url || result.description)),
		);
}

function extractGenericResult(value: JsonRecord | undefined): GenericResultItem | undefined {
	if (!value) return undefined;
	const profile = asRecord(value.profile);
	const metaUrl = asRecord(value.meta_url);
	const postalAddress = asRecord(value.postal_address);
	const creator = asRecord(value.creator);
	const publisher = asRecord(value.publisher);
	const video = asRecord(value.video);
	const videoCreator = asRecord(video?.creator);

	const addressParts = [
		firstString(postalAddress?.streetAddress, postalAddress?.street_address),
		firstString(postalAddress?.addressLocality, postalAddress?.city),
		firstString(postalAddress?.addressRegion, postalAddress?.region),
		firstString(postalAddress?.postalCode, postalAddress?.postal_code),
	]
		.filter((part): part is string => Boolean(part))
		.join(", ");

	const title = firstString(value.title, value.question, value.name, value.label);
	const url = firstString(value.url, value.website, profile?.url, metaUrl?.url);
	const description = firstString(
		value.description,
		value.snippet,
		value.answer,
		value.long_desc,
		value.content,
		addressParts || undefined,
	);
	const age = normalizeAge(firstString(value.age, value.page_age, value.date, value.published));
	const extraSnippets = asStringArray(value.extra_snippets).slice(0, MAX_EXTRA_SNIPPETS_PER_RESULT);
	const meta = [
		firstString(profile?.name, creator?.name, publisher?.name, videoCreator?.name),
		firstString(metaUrl?.display, metaUrl?.hostname, metaUrl?.path),
		firstString(value.language),
		firstString(value.type),
	]
		.filter((item): item is string => Boolean(item))
		.filter((item, index, array) => array.indexOf(item) === index);

	if (!title && !url && !description) return undefined;
	return { title, url, description, age, extraSnippets, meta };
}

function normalizeAge(value: string | undefined): string | undefined {
	if (!value) return undefined;
	if (/^\d{4}-\d{2}-\d{2}T/.test(value)) return value.slice(0, 10);
	return value;
}

function extractInfobox(value: unknown): ParsedInfobox | undefined {
	const record = asRecord(value);
	if (!record) return undefined;

	const title = firstString(record.title, record.name);
	const url = firstString(record.url);
	const description = firstString(record.description, record.long_desc);
	const attributes = extractInfoboxAttributes(record.attributes ?? record.data);

	if (!title && !url && !description && attributes.length === 0) return undefined;
	return { title, url, description, attributes };
}

function extractInfoboxAttributes(value: unknown): Array<{ label: string; value: string }> {
	if (Array.isArray(value)) {
		return value
			.map((entry) => {
				const record = asRecord(entry);
				const label = firstString(record?.label, record?.name, record?.key);
				const resultValue = firstString(record?.value, record?.description, record?.answer);
				if (!label || !resultValue) return undefined;
				return { label, value: resultValue };
			})
			.filter((entry): entry is { label: string; value: string } => Boolean(entry))
			.slice(0, 8);
	}

	const record = asRecord(value);
	if (!record) return [];
	return Object.entries(record)
		.map(([label, rawValue]) => {
			const resultValue = toDisplayString(rawValue);
			if (!resultValue) return undefined;
			return { label, value: resultValue };
		})
		.filter((entry): entry is { label: string; value: string } => Boolean(entry))
		.slice(0, 8);
}

function extractMixedReferences(payload: JsonRecord): MixedReference[] {
	const mixed = asRecord(payload.mixed);
	if (!mixed) return [];

	const references: MixedReference[] = [];
	for (const lane of ["top", "main", "side"] as const) {
		const entries = Array.isArray(mixed[lane]) ? mixed[lane] : [];
		for (const entry of entries) {
			const record = asRecord(entry);
			const section = toSearchSectionKey(record?.type);
			const index = toNonNegativeInteger(record?.index);
			if (!section || index === undefined) continue;
			references.push({ section, index, lane });
		}
	}
	return references;
}

function toSearchSectionKey(value: unknown): SearchSectionKey | undefined {
	if (typeof value !== "string") return undefined;
	return (DEFAULT_SECTION_ORDER as readonly string[]).includes(value) ? (value as SearchSectionKey) : undefined;
}

function toNonNegativeInteger(value: unknown): number | undefined {
	if (typeof value !== "number" || !Number.isInteger(value) || value < 0) return undefined;
	return value;
}

function renderSearchOutput(config: RequestConfig, parsed: ParsedResponse): string {
	const lines: string[] = [];
	const effectiveQuery = parsed.queryAltered?.trim() || parsed.queryOriginal?.trim() || config.query;
	const topResult = getTopResult(parsed);
	const sectionOrder = getRenderSectionOrder(parsed);
	const totalResults = Object.values(parsed.sections).reduce((sum, results) => sum + results.length, 0);
	const hasInfobox = Boolean(parsed.infobox);

	lines.push(`Query: ${effectiveQuery}`);
	if (parsed.queryAltered && parsed.queryAltered.trim() !== config.query) {
		lines.push(`Original query: ${config.query}`);
	}
	if (topResult) {
		lines.push(`Top result: ${topResult.item.title ?? "Untitled"} (${formatSectionLabel(topResult.section)})`);
		if (topResult.item.url) lines.push(`Top result URL: ${topResult.item.url}`);
	}
	lines.push(`Web results requested: ${config.count}`);
	if (typeof config.offset === "number") lines.push(`Offset: ${config.offset}`);
	if (config.country) lines.push(`Country: ${config.country}`);
	if (config.searchLanguage) lines.push(`Search language: ${config.searchLanguage}`);
	if (config.uiLanguage) lines.push(`UI language: ${config.uiLanguage}`);
	if (config.freshness) lines.push(`Freshness: ${config.freshness}`);
	if (config.resultTypes && config.resultTypes.length > 0) {
		lines.push(`Result filter: ${config.resultTypes.join(", ")}`);
	}
	if (typeof parsed.moreResultsAvailable === "boolean") {
		lines.push(`More results available: ${parsed.moreResultsAvailable ? "yes" : "no"}`);
	}
	if (sectionOrder.length > 0) {
		lines.push(
			`Sections: ${sectionOrder.map((section) => `${formatSectionLabel(section)} ${parsed.sections[section].length}`).join(" • ")}`,
		);
	}
	lines.push("");

	if (!hasInfobox && totalResults === 0) {
		lines.push("No search results were returned.");
		return lines.join("\n");
	}

	if (parsed.infobox) {
		lines.push("Infobox:");
		if (parsed.infobox.title) lines.push(`- ${parsed.infobox.title}`);
		if (parsed.infobox.url) lines.push(`  URL: ${parsed.infobox.url}`);
		if (parsed.infobox.description) lines.push(`  ${parsed.infobox.description}`);
		for (const attribute of parsed.infobox.attributes) {
			lines.push(`  ${attribute.label}: ${attribute.value}`);
		}
		lines.push("");
	}

	for (const key of sectionOrder) {
		const results = parsed.sections[key];
		if (results.length === 0) continue;
		lines.push(`${formatSectionLabel(key)} (${results.length}):`);
		for (const [index, result] of results.slice(0, MAX_RENDERED_RESULTS_PER_SECTION).entries()) {
			lines.push(`${index + 1}. ${result.title ?? "Untitled"}`);
			if (result.url) lines.push(`   URL: ${result.url}`);
			if (result.description) lines.push(`   ${result.description}`);
			if (result.age) lines.push(`   Age: ${result.age}`);
			if (result.meta.length > 0) lines.push(`   Meta: ${result.meta.join(" • ")}`);
			for (const snippet of result.extraSnippets) {
				lines.push(`   Extra: ${snippet}`);
			}
		}
		if (results.length > MAX_RENDERED_RESULTS_PER_SECTION) {
			lines.push(
				`… ${results.length - MAX_RENDERED_RESULTS_PER_SECTION} more ${formatSectionLabel(key).toLowerCase()} result(s)`,
			);
		}
		lines.push("");
	}

	return lines.join("\n").trim();
}

function getTopResult(parsed: ParsedResponse): RankedResult | undefined {
	for (const reference of parsed.mixedReferences) {
		const item = parsed.sections[reference.section][reference.index];
		if (item) return { section: reference.section, item, lane: reference.lane };
	}
	for (const section of DEFAULT_SECTION_ORDER) {
		const item = parsed.sections[section][0];
		if (item) return { section, item };
	}
	return undefined;
}

function getRenderSectionOrder(parsed: ParsedResponse): SearchSectionKey[] {
	const ordered: SearchSectionKey[] = [];
	const seen = new Set<SearchSectionKey>();

	for (const reference of parsed.mixedReferences) {
		if (seen.has(reference.section)) continue;
		if (parsed.sections[reference.section].length === 0) continue;
		seen.add(reference.section);
		ordered.push(reference.section);
	}

	for (const section of DEFAULT_SECTION_ORDER) {
		if (seen.has(section)) continue;
		if (parsed.sections[section].length === 0) continue;
		seen.add(section);
		ordered.push(section);
	}

	return ordered;
}

function formatSectionLabel(key: SearchSectionKey): string {
	return SECTION_LABELS[key];
}

function formatHttpError(
	status: number,
	payload: JsonRecord | undefined,
	rawBody: string,
	rateLimit: RateLimitInfo,
): string {
	if (status === 429) {
		const retrySeconds = rateLimit.retryAfterSeconds ?? rateLimit.resetSeconds;
		return retrySeconds !== undefined
			? `Brave web search is rate-limited (HTTP 429). Retry in about ${retrySeconds}s.`
			: "Brave web search is rate-limited (HTTP 429). Please retry shortly.";
	}

	const apiMessage = extractApiError(payload, rawBody);
	if (status === 401 || status === 403) {
		return apiMessage
			? `Brave rejected the API credential (HTTP ${status}): ${apiMessage}`
			: `Brave rejected the API credential (HTTP ${status}). Check your Brave Search API key.`;
	}

	return apiMessage
		? `Brave web search failed with HTTP ${status}: ${apiMessage}`
		: `Brave web search failed with HTTP ${status}.`;
}

function extractApiError(payload: JsonRecord | undefined, rawBody?: string): string | undefined {
	if (payload) {
		const nestedError = asRecord(payload.error);
		const errors = Array.isArray(payload.errors)
			? payload.errors
					.map((entry) => {
						const record = asRecord(entry);
						return firstString(record?.message, record?.detail, entry);
					})
					.filter((entry): entry is string => Boolean(entry))
					.join("; ")
			: undefined;
		const message = firstString(
			nestedError?.message,
			nestedError?.detail,
			payload.message,
			payload.detail,
			payload.details,
			errors,
		);
		if (message) return message;
	}
	return rawBody ? previewText(rawBody) : undefined;
}

function previewText(text: string, maxLength = 240): string {
	const normalized = text.replace(/\s+/g, " ").trim();
	if (!normalized) return "empty response";
	if (normalized.length <= maxLength) return normalized;
	return `${normalized.slice(0, maxLength - 1)}…`;
}

function asRecord(value: unknown): JsonRecord | undefined {
	if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
	return value as JsonRecord;
}

function firstString(...values: unknown[]): string | undefined {
	for (const value of values) {
		if (typeof value === "string") {
			const trimmed = value.trim();
			if (trimmed) return trimmed;
		}
	}
	return undefined;
}

function asStringArray(value: unknown): string[] {
	if (!Array.isArray(value)) return [];
	return value
		.map((entry) => (typeof entry === "string" ? entry.trim() : ""))
		.filter(Boolean);
}

function toDisplayString(value: unknown, depth = 0): string | undefined {
	if (depth > 2) return undefined;
	if (typeof value === "string") return value.trim() || undefined;
	if (typeof value === "number" || typeof value === "boolean") return String(value);
	if (Array.isArray(value)) {
		const joined = value
			.map((entry) => toDisplayString(entry, depth + 1))
			.filter(Boolean)
			.join(", ");
		return joined || undefined;
	}
	if (value && typeof value === "object") {
		const record = asRecord(value);
		return firstString(record?.value, record?.name, record?.label, record?.description);
	}
	return undefined;
}

function normalizeResultTypesAlias(value: unknown): unknown {
	if (typeof value === "string") {
		const parts = value
			.split(",")
			.map((entry) => entry.trim())
			.filter(Boolean);
		const valid = parts.filter(isSearchResultType);
		return valid.length > 0 ? valid : value;
	}
	if (Array.isArray(value)) {
		const valid = value.filter(isSearchResultType);
		return valid.length > 0 ? valid : value;
	}
	return value;
}

function coerceIntegerMaybe(value: unknown): unknown {
	if (typeof value !== "string") return value;
	if (!/^-?\d+$/.test(value.trim())) return value;
	const parsed = Number.parseInt(value, 10);
	return Number.isFinite(parsed) ? parsed : value;
}

function coerceBooleanMaybe(value: unknown): unknown {
	if (typeof value !== "string") return value;
	const normalized = value.trim().toLowerCase();
	if (["1", "true", "yes", "on"].includes(normalized)) return true;
	if (["0", "false", "no", "off"].includes(normalized)) return false;
	return value;
}

async function writeFullOutput(output: string): Promise<string | undefined> {
	try {
		const path = join(tmpdir(), `pi-web-search-${Date.now()}.txt`);
		await writeFile(path, output, "utf8");
		return path;
	} catch {
		return undefined;
	}
}

function formatRuntimeError(error: unknown): string {
	if (error instanceof Error) return error.message;
	return String(error);
}
