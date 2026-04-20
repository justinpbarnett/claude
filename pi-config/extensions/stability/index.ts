import type {
	ExtensionAPI,
	ExtensionCommandContext,
	ExtensionContext,
} from "@mariozechner/pi-coding-agent";
import {
	convertToLlm,
	DynamicBorder,
	serializeConversation,
} from "@mariozechner/pi-coding-agent";
import { complete } from "@mariozechner/pi-ai";
import { Container, Key, Text, matchesKey, truncateToWidth } from "@mariozechner/pi-tui";
import { existsSync, readFileSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import { homedir } from "node:os";

const EXTENSION_NAME = "stability";
const STATUS_ID = "stability";
const WIDGET_ID = "stability-widget";
const CHECKPOINT_ENTRY_TYPE = "stability-checkpoint";
const AUTO_RESUME_MESSAGE_TYPE = "stability-auto-resume";
const CONFIG_PATH = join(homedir(), ".pi", "agent", "extensions", EXTENSION_NAME, "config.json");

const DEFAULT_COMPACTION_REQUIREMENTS = `Preserve the information needed to continue work confidently.

Requirements:
- Keep the summary cumulative so it fully replaces earlier session history.
- Preserve the user's current goal, constraints, preferences, and explicit requests.
- Preserve key decisions and their rationale.
- Preserve concrete next steps and the current best plan.
- Preserve exact file paths, commands, APIs, errors, and technical findings that matter.
- Preserve unresolved blockers, risks, and open questions.
- Prefer dense structured markdown over prose.
- Avoid filler and repetition.`;

const DEFAULT_SUMMARY_TEMPLATE = `Format the output as structured markdown with these sections when relevant:

## Goal
## Constraints & Preferences
## Progress
### Done
### In Progress
### Blocked
## Key Decisions
## Next Steps
## Critical Context
<read-files>
...
</read-files>
<modified-files>
...
</modified-files>`;

type ShowWidgetMode = "off" | "warn" | "always";
type StabilityPhase = "unknown" | "stable" | "warn" | "compacting" | "failed";
type CheckpointKind = "manual" | "pre-compact" | "major-edit" | "pre-mutate-git";

type CommandContext = ExtensionContext | ExtensionCommandContext;

type StabilityConfig = {
	enabled: boolean;
	showStatus: boolean;
	showWidget: ShowWidgetMode;
	warnPct: number;
	compactPct: number;
	hardPct: number;
	fallbackWarnTokens: number;
	fallbackCompactTokens: number;
	fallbackHardTokens: number;
	minTurnsBetweenCompactions: number;
	minMsBetweenCompactions: number;
	trendTurns: number;
	autoLabelLimit: number;
	defaultProfile: string;
	summaryMaxTokens: number;
	gitSnapshots: {
		enabled: boolean;
		mode: "risky-turns";
	};
};

type StabilityRepoConfig = Partial<StabilityConfig> & {
	profile?: string;
	gitSnapshots?: Partial<StabilityConfig["gitSnapshots"]>;
};

type UsageSample = {
	turn: number;
	tokens: number;
	timestamp: number;
};

type CheckpointRecord = {
	checkpointId: string;
	number: number;
	kind: CheckpointKind;
	entryId?: string;
	label?: string;
	timestamp: number;
	repoRoot?: string;
	model?: string;
	contextTokens?: number;
	contextPct?: number;
	modifiedFiles?: string[];
	gitRef?: string;
	note?: string;
};

type AutoLabel = {
	entryId: string;
	label: string;
	createdAt: number;
};

type TurnMutationState = {
	mutated: boolean;
	riskyMutation: boolean;
	modifiedFiles: Set<string>;
	diffAdded: number;
	diffRemoved: number;
	gitSnapshotRef?: string;
	recordedPreMutationCheckpoint: boolean;
};

type RuntimeState = {
	cwd: string;
	projectRoot: string;
	repoName: string;
	profile: string;
	config: StabilityConfig;
	isGitRepo: boolean;
	turnIndex: number;
	usageHistory: UsageSample[];
	phase: StabilityPhase;
	lastNotifiedPhase?: StabilityPhase;
	lastCompactionAt?: number;
	lastCompactionTurn?: number;
	lastCompactionError?: string;
	lastCheckpoint?: CheckpointRecord;
	checkpointCounter: number;
	compactionCounter: number;
	editCounter: number;
	autoLabels: AutoLabel[];
	isCompacting: boolean;
	currentTurn: TurnMutationState;
};

const DEFAULT_CONFIG: StabilityConfig = {
	enabled: true,
	showStatus: true,
	showWidget: "warn",
	warnPct: 0.65,
	compactPct: 0.78,
	hardPct: 0.85,
	fallbackWarnTokens: 60_000,
	fallbackCompactTokens: 90_000,
	fallbackHardTokens: 110_000,
	minTurnsBetweenCompactions: 2,
	minMsBetweenCompactions: 90_000,
	trendTurns: 4,
	autoLabelLimit: 10,
	defaultProfile: "coding",
	summaryMaxTokens: 6_000,
	gitSnapshots: {
		enabled: false,
		mode: "risky-turns",
	},
};

function createEmptyTurnState(): TurnMutationState {
	return {
		mutated: false,
		riskyMutation: false,
		modifiedFiles: new Set<string>(),
		diffAdded: 0,
		diffRemoved: 0,
		gitSnapshotRef: undefined,
		recordedPreMutationCheckpoint: false,
	};
}

function formatCompactNumber(value: number): string {
	if (!Number.isFinite(value)) return "--";
	if (Math.abs(value) < 1_000) return `${Math.round(value)}`;
	if (Math.abs(value) < 10_000) return `${(value / 1_000).toFixed(1)}k`;
	if (Math.abs(value) < 1_000_000) return `${Math.round(value / 1_000)}k`;
	return `${(value / 1_000_000).toFixed(1)}m`;
}

function formatPercent(pct?: number): string {
	if (pct === undefined || !Number.isFinite(pct)) return "--";
	return `${Math.round(pct * 100)}%`;
}

function formatAge(timestamp?: number): string {
	if (!timestamp) return "never";
	const deltaMs = Math.max(0, Date.now() - timestamp);
	const minutes = Math.floor(deltaMs / 60_000);
	if (minutes < 1) return "just now";
	if (minutes < 60) return `${minutes}m ago`;
	const hours = Math.floor(minutes / 60);
	if (hours < 24) return `${hours}h ago`;
	const days = Math.floor(hours / 24);
	return `${days}d ago`;
}

function slugifyLabel(input: string): string {
	const trimmed = input.trim().toLowerCase();
	const slug = trimmed.replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
	return slug || `${Date.now()}`;
}

function countDiffLines(diff: string): { added: number; removed: number } {
	let added = 0;
	let removed = 0;
	for (const line of diff.split("\n")) {
		if (line.startsWith("+") && !line.startsWith("+++")) added += 1;
		if (line.startsWith("-") && !line.startsWith("---")) removed += 1;
	}
	return { added, removed };
}

function normalizePath(path: string | undefined, cwd: string, root: string): string | undefined {
	if (!path) return undefined;
	const trimmed = path.startsWith("@") ? path.slice(1) : path;
	const absolute = resolve(cwd, trimmed);
	if (absolute.startsWith(root)) {
		const relativePath = absolute.slice(root.length).replace(/^\/+/, "");
		return relativePath || basename(absolute);
	}
	return trimmed;
}

function parseIsoTimestamp(value: unknown): number | undefined {
	if (typeof value !== "string") return undefined;
	const parsed = Date.parse(value);
	return Number.isNaN(parsed) ? undefined : parsed;
}

function parseLabelNumber(label: string, prefix: string): number {
	if (!label.startsWith(prefix)) return 0;
	const value = Number.parseInt(label.slice(prefix.length), 10);
	return Number.isFinite(value) ? value : 0;
}

function isAutoLabel(label: string | undefined): boolean {
	return Boolean(label && (label.startsWith("cmp/") || label.startsWith("edit/")));
}

function isRiskyBash(command: string): boolean {
	const normalized = command.replace(/\s+/g, " ").trim();
	if (!normalized) return false;
	const patterns = [
		/\bgit\s+(add|commit|apply|checkout|restore|reset|clean)\b/,
		/\brm\b/,
		/\bmv\b/,
		/\bcp\b/,
		/\bmkdir\b/,
		/\btouch\b/,
		/\bnpm\s+install\b/,
		/\bpnpm\s+(install|add)\b/,
		/\byarn\s+(add|install)\b/,
		/\bpip\s+install\b/,
		/\btee\b/,
		/>\s*[^&]/,
	];
	return patterns.some((pattern) => pattern.test(normalized));
}

function mergeConfigs(globalConfig: StabilityConfig, repoConfig: StabilityRepoConfig | undefined): StabilityConfig {
	if (!repoConfig) return globalConfig;
	return {
		...globalConfig,
		...repoConfig,
		gitSnapshots: {
			...globalConfig.gitSnapshots,
			...(repoConfig.gitSnapshots ?? {}),
		},
	};
}

function computeAverageGrowth(samples: UsageSample[], trendTurns: number): number {
	if (samples.length < 2) return 0;
	const recent = samples.slice(-(trendTurns + 1));
	const deltas: number[] = [];
	for (let i = 1; i < recent.length; i += 1) {
		const delta = recent[i]!.tokens - recent[i - 1]!.tokens;
		if (delta > 0) deltas.push(delta);
	}
	if (deltas.length === 0) return 0;
	return deltas.reduce((sum, value) => sum + value, 0) / deltas.length;
}

function deriveMetrics(state: RuntimeState, ctx: ExtensionContext) {
	const usage = ctx.getContextUsage();
	const tokens = usage?.tokens;
	const contextWindow = ctx.model?.contextWindow;
	const pct = tokens !== undefined && contextWindow ? tokens / contextWindow : undefined;
	const avgGrowth = computeAverageGrowth(state.usageHistory, state.config.trendTurns);
	const projectedNextTokens = tokens !== undefined ? tokens + avgGrowth : undefined;
	const projectedPct = projectedNextTokens !== undefined && contextWindow ? projectedNextTokens / contextWindow : undefined;
	return {
		tokens,
		contextWindow,
		pct,
		avgGrowth,
		projectedNextTokens,
		projectedPct,
	};
}

function getThresholds(state: RuntimeState, ctx: ExtensionContext) {
	const contextWindow = ctx.model?.contextWindow;
	if (contextWindow && contextWindow > 0) {
		return {
			warnTokens: Math.round(contextWindow * state.config.warnPct),
			compactTokens: Math.round(contextWindow * state.config.compactPct),
			hardTokens: Math.round(contextWindow * state.config.hardPct),
			usingPercentages: true,
		};
	}
	return {
		warnTokens: state.config.fallbackWarnTokens,
		compactTokens: state.config.fallbackCompactTokens,
		hardTokens: state.config.fallbackHardTokens,
		usingPercentages: false,
	};
}

function buildStatusLine(state: RuntimeState, ctx: ExtensionContext): string | undefined {
	if (!state.config.enabled || !state.config.showStatus) return undefined;
	const { tokens, pct, avgGrowth, projectedPct } = deriveMetrics(state, ctx);
	const deltaText = avgGrowth > 0 ? ` Δ+${formatCompactNumber(avgGrowth)}` : "";
	if (state.isCompacting) return `compacting ctx ${formatPercent(pct)}${deltaText}`;
	if (state.lastCompactionError) return `compact failed ctx ${formatPercent(pct)}${deltaText}`;
	if (tokens === undefined) return `ctx --`;

	const thresholds = getThresholds(state, ctx);
	const nearCompact = tokens >= thresholds.compactTokens || (projectedPct !== undefined && projectedPct >= state.config.hardPct);
	if (nearCompact) return `compact soon ctx ${formatPercent(pct)}${deltaText}`;
	if (tokens >= thresholds.warnTokens) return `warn ctx ${formatPercent(pct)}${deltaText}`;
	return `stable ctx ${formatPercent(pct)}${deltaText}`;
}

function shouldShowWidget(state: RuntimeState): boolean {
	if (!state.config.enabled) return false;
	const mode = state.config.showWidget;
	return mode === "always" || (mode === "warn" && (state.phase === "warn" || state.phase === "compacting" || state.phase === "failed"));
}

export default function stabilityExtension(pi: ExtensionAPI) {
	const state: RuntimeState = {
		cwd: process.cwd(),
		projectRoot: process.cwd(),
		repoName: basename(process.cwd()),
		profile: DEFAULT_CONFIG.defaultProfile,
		config: DEFAULT_CONFIG,
		isGitRepo: false,
		turnIndex: 0,
		usageHistory: [],
		phase: "unknown",
		lastNotifiedPhase: undefined,
		lastCompactionAt: undefined,
		lastCompactionTurn: undefined,
		lastCompactionError: undefined,
		lastCheckpoint: undefined,
		checkpointCounter: 0,
		compactionCounter: 0,
		editCounter: 0,
		autoLabels: [],
		isCompacting: false,
		currentTurn: createEmptyTurnState(),
	};

	function loadGlobalConfigSync(): StabilityConfig {
		try {
			const raw = readFileSync(CONFIG_PATH, "utf8");
			const parsed = JSON.parse(raw) as StabilityRepoConfig;
			return mergeConfigs(DEFAULT_CONFIG, parsed as StabilityRepoConfig);
		} catch {
			return DEFAULT_CONFIG;
		}
	}

	async function ensureGlobalConfigFile(): Promise<void> {
		if (existsSync(CONFIG_PATH)) return;
		await mkdir(dirname(CONFIG_PATH), { recursive: true });
		await writeFile(CONFIG_PATH, `${JSON.stringify(DEFAULT_CONFIG, null, 2)}\n`, "utf8");
	}

	async function loadRepoConfig(projectRoot: string): Promise<StabilityRepoConfig | undefined> {
		const path = join(projectRoot, ".pi", "stability.json");
		try {
			const raw = await readFile(path, "utf8");
			return JSON.parse(raw) as StabilityRepoConfig;
		} catch {
			return undefined;
		}
	}

	async function detectProjectRoot(ctx: ExtensionContext): Promise<{ root: string; isGitRepo: boolean }> {
		try {
			const result = await pi.exec("git", ["rev-parse", "--show-toplevel"], { timeout: 3000 });
			const root = result.stdout.trim();
			if (root) return { root, isGitRepo: true };
		} catch {
			// ignore
		}
		return { root: ctx.cwd, isGitRepo: false };
	}

	async function refreshProjectContext(ctx: ExtensionContext) {
		await ensureGlobalConfigFile();
		const globalConfig = loadGlobalConfigSync();
		const detected = await detectProjectRoot(ctx);
		const repoConfig = await loadRepoConfig(detected.root);
		state.cwd = ctx.cwd;
		state.projectRoot = detected.root;
		state.repoName = basename(detected.root);
		state.isGitRepo = detected.isGitRepo;
		state.profile = repoConfig?.profile?.trim() || globalConfig.defaultProfile;
		state.config = mergeConfigs(globalConfig, repoConfig);
	}

	function rebuildStateFromSession(ctx: ExtensionContext) {
		state.turnIndex = 0;
		state.usageHistory = [];
		state.lastCheckpoint = undefined;
		state.checkpointCounter = 0;
		state.compactionCounter = 0;
		state.editCounter = 0;
		state.autoLabels = [];
		state.lastCompactionAt = undefined;
		state.lastCompactionError = undefined;
		state.isCompacting = false;
		state.currentTurn = createEmptyTurnState();

		const branch = ctx.sessionManager.getBranch();
		for (const entry of branch) {
			if (entry.type === "message" && entry.message.role === "assistant") {
				state.turnIndex += 1;
			}
			if (entry.type === "custom" && entry.customType === CHECKPOINT_ENTRY_TYPE) {
				const data = entry.data as Partial<CheckpointRecord> | undefined;
				if (data?.number && data.number > state.checkpointCounter) state.checkpointCounter = data.number;
				if (data?.timestamp && (!state.lastCheckpoint || data.timestamp >= state.lastCheckpoint.timestamp)) {
					state.lastCheckpoint = data as CheckpointRecord;
				}
			}
			if (entry.type === "compaction") {
				state.compactionCounter += 1;
				const timestamp = parseIsoTimestamp(entry.timestamp);
				if (timestamp && (!state.lastCompactionAt || timestamp >= state.lastCompactionAt)) {
					state.lastCompactionAt = timestamp;
				}
			}
			const label = ctx.sessionManager.getLabel(entry.id);
			if (label) {
				state.compactionCounter = Math.max(state.compactionCounter, parseLabelNumber(label, "cmp/"));
				state.editCounter = Math.max(state.editCounter, parseLabelNumber(label, "edit/"));
				if (isAutoLabel(label)) {
					state.autoLabels.push({
						entryId: entry.id,
						label,
						createdAt: parseIsoTimestamp(entry.timestamp) ?? Date.now(),
					});
				}
			}
		}
		state.autoLabels.sort((a, b) => a.createdAt - b.createdAt);
	}

	async function readOptionalText(path: string): Promise<string | undefined> {
		try {
			const raw = await readFile(path, "utf8");
			const trimmed = raw.trim();
			return trimmed || undefined;
		} catch {
			return undefined;
		}
	}

	async function resolveCompactionInstructions(customInstructions?: string): Promise<string> {
		const profilePrompt = await readOptionalText(join(state.projectRoot, ".pi", `compaction.${state.profile}.md`));
		const genericPrompt = await readOptionalText(join(state.projectRoot, ".pi", "compaction.md"));
		const blocks = [
			DEFAULT_COMPACTION_REQUIREMENTS,
			`Project profile: ${state.profile}`,
			DEFAULT_SUMMARY_TEMPLATE,
		];
		if (profilePrompt) blocks.push(`Profile-specific instructions:\n${profilePrompt}`);
		else if (genericPrompt) blocks.push(`Project-specific instructions:\n${genericPrompt}`);
		if (customInstructions?.trim()) blocks.push(`Additional focus from the user:\n${customInstructions.trim()}`);
		return blocks.join("\n\n");
	}

	function updatePhase(ctx: ExtensionContext) {
		if (!state.config.enabled) {
			state.phase = "unknown";
			return;
		}
		if (state.isCompacting) {
			state.phase = "compacting";
			return;
		}
		if (state.lastCompactionError) {
			state.phase = "failed";
			return;
		}
		const { tokens } = deriveMetrics(state, ctx);
		if (tokens === undefined) {
			state.phase = "unknown";
			return;
		}
		const thresholds = getThresholds(state, ctx);
		state.phase = tokens >= thresholds.warnTokens ? "warn" : "stable";
	}

	function mountWidget(ctx: ExtensionContext) {
		if (!ctx.hasUI) return;
		if (!shouldShowWidget(state)) {
			ctx.ui.setWidget(WIDGET_ID, undefined);
			return;
		}
		ctx.ui.setWidget(
			WIDGET_ID,
			() => ({
				render(width: number): string[] {
					const theme = ctx.ui.theme;
					const { tokens, contextWindow, pct, avgGrowth } = deriveMetrics(state, ctx);
					const line1 = `${theme.fg("accent", "STABILITY")} ${theme.fg("borderMuted", "─")} ${theme.fg("text", state.phase)}   ${theme.fg("muted", "profile")} ${theme.fg("text", state.profile)}`;
					const line2 = `${theme.fg("muted", "ctx")} ${theme.fg("text", tokens !== undefined ? formatCompactNumber(tokens) : "--")} ${theme.fg("muted", "/")} ${theme.fg("text", contextWindow ? formatCompactNumber(contextWindow) : "--")}   ${theme.fg("muted", "used")} ${theme.fg("text", formatPercent(pct))}   ${theme.fg("muted", "delta")} ${theme.fg("text", avgGrowth > 0 ? `+${formatCompactNumber(avgGrowth)}` : "--")}`;
					const checkpointText = state.lastCheckpoint?.label || state.lastCheckpoint?.kind || "none";
					const line3 = `${theme.fg("muted", "last compact")} ${theme.fg("text", formatAge(state.lastCompactionAt))}   ${theme.fg("muted", "checkpoint")} ${theme.fg("text", checkpointText)}`;
					return [line1, line2, line3].map((line) => truncateToWidth(line, width));
				},
				invalidate() {},
			}),
			{ placement: "aboveEditor" },
		);
	}

	function refreshChrome(ctx: ExtensionContext) {
		updatePhase(ctx);
		if (ctx.hasUI) {
			ctx.ui.setStatus(STATUS_ID, buildStatusLine(state, ctx));
			mountWidget(ctx);
		}
	}

	function maybeNotifyPhaseChange(ctx: ExtensionContext) {
		if (!ctx.hasUI) return;
		if (state.phase === state.lastNotifiedPhase) return;
		if (state.phase === "warn") ctx.ui.notify("Stability: session entering warning zone", "warning");
		if (state.phase === "compacting") ctx.ui.notify("Stability: compacting early", "info");
		if (state.phase === "failed" && state.lastCompactionError) ctx.ui.notify(`Stability: compaction failed: ${state.lastCompactionError}`, "error");
		state.lastNotifiedPhase = state.phase;
	}

	function currentLeafId(ctx: CommandContext): string | undefined {
		return ctx.sessionManager.getLeafEntry()?.id;
	}

	function appendCheckpoint(
		ctx: CommandContext,
		kind: CheckpointKind,
		options?: {
			label?: string;
			note?: string;
			modifiedFiles?: string[];
			gitRef?: string;
			entryId?: string;
		},
	) {
		const usage = ctx.getContextUsage();
		const contextWindow = ctx.model?.contextWindow;
		const pct = usage?.tokens !== undefined && contextWindow ? usage.tokens / contextWindow : undefined;
		const record: CheckpointRecord = {
			checkpointId: `${Date.now()}-${state.checkpointCounter + 1}`,
			number: state.checkpointCounter + 1,
			kind,
			entryId: options?.entryId ?? currentLeafId(ctx),
			label: options?.label,
			timestamp: Date.now(),
			repoRoot: state.projectRoot,
			model: ctx.model ? `${ctx.model.provider}/${ctx.model.id}` : undefined,
			contextTokens: usage?.tokens,
			contextPct: pct,
			modifiedFiles: options?.modifiedFiles,
			gitRef: options?.gitRef,
			note: options?.note,
		};
		state.checkpointCounter = record.number;
		state.lastCheckpoint = record;
		pi.appendEntry(CHECKPOINT_ENTRY_TYPE, record);
	}

	function addAutoLabel(ctx: CommandContext, entryId: string, label: string) {
		pi.setLabel(entryId, label);
		state.autoLabels.push({ entryId, label, createdAt: Date.now() });
		while (state.autoLabels.length > state.config.autoLabelLimit) {
			const oldest = state.autoLabels.shift();
			if (!oldest) break;
			pi.setLabel(oldest.entryId, undefined);
		}
	}

	async function maybeSnapshotGit(ctx: ExtensionContext) {
		if (!state.config.gitSnapshots.enabled || !state.isGitRepo || state.currentTurn.gitSnapshotRef) return;
		try {
			const result = await pi.exec("git", ["stash", "create"], { timeout: 5_000, signal: ctx.signal });
			const ref = result.stdout.trim();
			if (!ref) return;
			state.currentTurn.gitSnapshotRef = ref;
			appendCheckpoint(ctx, "pre-mutate-git", {
				note: "before risky mutation phase",
				gitRef: ref,
			});
		} catch {
			// ignore snapshot failures
		}
	}

	async function hydrateModifiedFilesFromGit(ctx: ExtensionContext) {
		if (!state.isGitRepo || !state.currentTurn.riskyMutation) return;
		try {
			const diff = await pi.exec("git", ["diff", "--name-only", "--relative"], { timeout: 5_000, signal: ctx.signal });
			for (const line of diff.stdout.split("\n")) {
				const trimmed = line.trim();
				if (trimmed) state.currentTurn.modifiedFiles.add(trimmed);
			}
			const untracked = await pi.exec("git", ["status", "--porcelain"], { timeout: 5_000, signal: ctx.signal });
			for (const line of untracked.stdout.split("\n")) {
				const trimmed = line.trim();
				if (!trimmed) continue;
				const file = trimmed.slice(3).trim();
				if (file) state.currentTurn.modifiedFiles.add(file);
			}
		} catch {
			// ignore git diff failures
		}
	}

	function shouldAutoCompact(ctx: ExtensionContext): boolean {
		if (!state.config.enabled || state.isCompacting) return false;
		const now = Date.now();
		if (state.lastCompactionAt && now - state.lastCompactionAt < state.config.minMsBetweenCompactions) return false;
		if (
			state.lastCompactionTurn !== undefined &&
			state.turnIndex - state.lastCompactionTurn < state.config.minTurnsBetweenCompactions
		)
			return false;

		const { tokens, projectedNextTokens } = deriveMetrics(state, ctx);
		if (tokens === undefined) return false;
		const thresholds = getThresholds(state, ctx);
		if (tokens >= thresholds.compactTokens) return true;
		if (projectedNextTokens !== undefined && projectedNextTokens >= thresholds.hardTokens) return true;
		return false;
	}

	async function runCompaction(
		ctx: CommandContext,
		options?: {
			customInstructions?: string;
			resumeAgentFlow?: boolean;
		},
	) {
		if (state.isCompacting) return;
		state.isCompacting = true;
		state.lastCompactionError = undefined;
		const customInstructions = options?.customInstructions;
		const resumeAgentFlow = options?.resumeAgentFlow === true;
		if (ctx.hasUI) {
			refreshChrome(ctx);
			maybeNotifyPhaseChange(ctx);
		}
		ctx.compact({
			customInstructions,
			onComplete: () => {
				state.isCompacting = false;
				state.lastCompactionError = undefined;
				state.lastCompactionAt = Date.now();
				state.lastCompactionTurn = state.turnIndex;
				state.usageHistory = [];
				if (ctx.hasUI) {
					refreshChrome(ctx);
					ctx.ui.notify("Stability: compaction completed", "info");
				}
				if (resumeAgentFlow) {
					const hadPendingMessages = ctx.hasPendingMessages();
					const content = hadPendingMessages
						? "Stability auto-compaction completed. Resume the interrupted workflow from the compacted summary and process any queued follow-up context before stopping. Do not ask the user to repeat prior context."
						: "Stability auto-compaction completed. Resume the interrupted workflow from the compacted summary and continue with the next best step. Do not ask the user to repeat prior context.";
					pi.sendMessage(
						{
							customType: AUTO_RESUME_MESSAGE_TYPE,
							content,
							display: false,
							details: {
								source: EXTENSION_NAME,
								reason: "auto-compaction",
								hadPendingMessages,
							},
						},
						{ triggerTurn: true },
					);
				}
			},
			onError: (error) => {
				state.isCompacting = false;
				state.lastCompactionError = error.message;
				if (ctx.hasUI) {
					refreshChrome(ctx);
					maybeNotifyPhaseChange(ctx);
				}
			},
		});
	}

	async function showPanel(ctx: ExtensionCommandContext) {
		if (!ctx.hasUI) return;
		const { tokens, contextWindow, pct, avgGrowth, projectedNextTokens } = deriveMetrics(state, ctx);
		const thresholds = getThresholds(state, ctx);
		await ctx.ui.custom(
			(_tui, theme, _keybindings, done) => {
				const container = new Container();
				const border = new DynamicBorder((s: string) => theme.fg("accent", s));
				const checkpointText = state.lastCheckpoint?.label || state.lastCheckpoint?.kind || "none";
				const title = `${theme.fg("accent", theme.bold("STABILITY"))} ${theme.fg("muted", "// session control state")}`;
				const summary = `${theme.fg("muted", "phase")} ${theme.fg("text", state.phase)}   ${theme.fg("muted", "profile")} ${theme.fg("text", state.profile)}   ${theme.fg("muted", "repo")} ${theme.fg("text", state.repoName)}`;
				const line1 = `${theme.fg("muted", "context")} ${theme.fg("text", tokens !== undefined ? formatCompactNumber(tokens) : "--")} ${theme.fg("muted", "/")} ${theme.fg("text", contextWindow ? formatCompactNumber(contextWindow) : "--")}   ${theme.fg("muted", "used")} ${theme.fg("text", formatPercent(pct))}`;
				const line2 = `${theme.fg("muted", "trend")} ${theme.fg("text", avgGrowth > 0 ? `+${formatCompactNumber(avgGrowth)} / turn` : "--")}   ${theme.fg("muted", "projected next")} ${theme.fg("text", projectedNextTokens !== undefined ? formatCompactNumber(projectedNextTokens) : "--")}`;
				const line3 = `${theme.fg("muted", "warn threshold")} ${theme.fg("text", formatCompactNumber(thresholds.warnTokens))}   ${theme.fg("muted", "compact threshold")} ${theme.fg("text", formatCompactNumber(thresholds.compactTokens))}`;
				const line4 = `${theme.fg("muted", "last compact")} ${theme.fg("text", formatAge(state.lastCompactionAt))}   ${theme.fg("muted", "last checkpoint")} ${theme.fg("text", checkpointText)}`;
				const line5 = `${theme.fg("muted", "git snapshots")} ${theme.fg("text", state.config.gitSnapshots.enabled ? "on" : "off")}`;
				const footer = theme.fg("dim", "Enter or Esc to close");

				container.addChild(border);
				container.addChild(new Text(title, 2, 0));
				container.addChild(new Text(summary, 2, 0));
				container.addChild(new Text("", 0, 0));
				container.addChild(new Text(line1, 2, 0));
				container.addChild(new Text(line2, 2, 0));
				container.addChild(new Text(line3, 2, 0));
				container.addChild(new Text(line4, 2, 0));
				container.addChild(new Text(line5, 2, 0));
				container.addChild(new Text("", 0, 0));
				container.addChild(new Text(footer, 2, 0));
				container.addChild(border);

				return {
					render(width: number) {
						return container.render(width);
					},
					invalidate() {
						container.invalidate();
					},
					handleInput(data: string) {
						if (matchesKey(data, Key.enter) || matchesKey(data, Key.escape)) done(undefined);
					},
				};
			},
			{
				overlay: true,
				overlayOptions: {
					anchor: "center",
					width: 72,
					minWidth: 56,
					maxHeight: 16,
					margin: 1,
					offsetY: -1,
				},
			},
		);
	}

	pi.on("session_start", async (_event, ctx) => {
		await refreshProjectContext(ctx);
		rebuildStateFromSession(ctx);
		refreshChrome(ctx);
	});

	pi.on("model_select", async (_event, ctx) => {
		refreshChrome(ctx);
	});

	pi.on("turn_start", async (_event, ctx) => {
		state.turnIndex += 1;
		state.currentTurn = createEmptyTurnState();
		refreshChrome(ctx);
	});

	pi.on("tool_call", async (event, ctx) => {
		if (!state.config.enabled) return;
		let isMutation = false;
		let risky = false;
		if (event.toolName === "edit" || event.toolName === "write") {
			isMutation = true;
			risky = true;
		} else if (event.toolName === "bash") {
			const command = typeof (event.input as { command?: unknown }).command === "string"
				? ((event.input as { command: string }).command)
				: "";
			if (isRiskyBash(command)) {
				isMutation = true;
				risky = true;
			}
		}
		if (!isMutation) return;
		state.currentTurn.mutated = true;
		if (risky) state.currentTurn.riskyMutation = true;
		if (risky) await maybeSnapshotGit(ctx);
	});

	pi.on("tool_result", async (event, ctx) => {
		if (!state.config.enabled) return;
		if (event.toolName === "edit" || event.toolName === "write") {
			const input = event.input as { path?: string };
			const normalized = normalizePath(input.path, ctx.cwd, state.projectRoot);
			if (normalized) state.currentTurn.modifiedFiles.add(normalized);
			state.currentTurn.mutated = true;
			state.currentTurn.riskyMutation = true;
			const diff = (event.details as { diff?: string } | undefined)?.diff;
			if (typeof diff === "string") {
				const counts = countDiffLines(diff);
				state.currentTurn.diffAdded += counts.added;
				state.currentTurn.diffRemoved += counts.removed;
			}
		}
		if (event.toolName === "bash") {
			const input = event.input as { command?: string };
			if (typeof input.command === "string" && isRiskyBash(input.command)) {
				state.currentTurn.mutated = true;
				state.currentTurn.riskyMutation = true;
			}
		}
	});

	pi.on("turn_end", async (_event, ctx) => {
		if (!state.config.enabled) {
			refreshChrome(ctx);
			return;
		}

		const usage = ctx.getContextUsage();
		if (usage?.tokens !== undefined) {
			state.usageHistory.push({
				turn: state.turnIndex,
				tokens: usage.tokens,
				timestamp: Date.now(),
			});
			const keep = Math.max(2, state.config.trendTurns + 2);
			if (state.usageHistory.length > keep) state.usageHistory = state.usageHistory.slice(-keep);
		}

		if (state.currentTurn.mutated) {
			await hydrateModifiedFilesFromGit(ctx);
			const modifiedFiles = Array.from(state.currentTurn.modifiedFiles).sort();
			const diffLines = state.currentTurn.diffAdded + state.currentTurn.diffRemoved;
			const majorEdit = modifiedFiles.length >= 2 || diffLines >= 40 || state.currentTurn.riskyMutation;
			if (majorEdit) {
				const leafId = currentLeafId(ctx);
				const label = `edit/${state.editCounter + 1}`;
				appendCheckpoint(ctx, "major-edit", {
					label,
					modifiedFiles,
					gitRef: state.currentTurn.gitSnapshotRef,
					note: "major edit turn",
					entryId: leafId,
				});
				if (leafId) {
					state.editCounter += 1;
					addAutoLabel(ctx, leafId, label);
				}
			}
		}

		refreshChrome(ctx);
		maybeNotifyPhaseChange(ctx);

		if (shouldAutoCompact(ctx)) {
			await runCompaction(ctx, { resumeAgentFlow: true });
		}
	});

	pi.on("session_before_compact", async (event, ctx) => {
		if (!state.config.enabled) return;
		appendCheckpoint(ctx, "pre-compact", {
			note: "before compaction",
			modifiedFiles: Array.from(state.currentTurn.modifiedFiles),
			gitRef: state.currentTurn.gitSnapshotRef,
			entryId: event.preparation.firstKeptEntryId,
		});

		const model = ctx.model;
		if (!model) return;
		const auth = await ctx.modelRegistry.getApiKeyAndHeaders(model);
		if (!auth.ok || !auth.apiKey) return;

		const allMessages = [...event.preparation.messagesToSummarize, ...event.preparation.turnPrefixMessages];
		if (allMessages.length === 0 && !event.preparation.previousSummary) return;

		const conversationText = serializeConversation(convertToLlm(allMessages));
		const instructions = await resolveCompactionInstructions(event.customInstructions);
		const fileOps = (event.preparation.fileOps as { readFiles?: string[]; modifiedFiles?: string[] } | undefined) ?? {};
		const readFiles = (fileOps.readFiles ?? []).slice(0, 200).join("\n") || "(none)";
		const modifiedFiles = (fileOps.modifiedFiles ?? []).slice(0, 200).join("\n") || "(none)";
		const previousSummary = event.preparation.previousSummary?.trim() || "(none)";

		try {
			const response = await complete(
				model,
				{
					messages: [
						{
							role: "user",
							content: [
								{
									type: "text",
									text: `You are compacting a coding-agent session into a cumulative summary that will replace earlier history.

${instructions}

Existing cumulative summary:
${previousSummary}

Tracked read files:
${readFiles}

Tracked modified files:
${modifiedFiles}

Conversation segment to summarize:
<conversation>
${conversationText}
</conversation>

Return only the summary markdown.`,
								},
							],
							timestamp: Date.now(),
						},
					],
				},
				{
					apiKey: auth.apiKey,
					headers: auth.headers,
					maxTokens: state.config.summaryMaxTokens,
					signal: event.signal,
				},
			);
			const summary = response.content
				.filter((item): item is { type: "text"; text: string } => item.type === "text")
				.map((item) => item.text)
				.join("\n")
				.trim();
			if (!summary) return;
			return {
				compaction: {
					summary,
					firstKeptEntryId: event.preparation.firstKeptEntryId,
					tokensBefore: event.preparation.tokensBefore,
					details: {
						readFiles: fileOps.readFiles ?? [],
						modifiedFiles: fileOps.modifiedFiles ?? [],
						profile: state.profile,
						source: EXTENSION_NAME,
					},
				},
			};
		} catch (error) {
			state.lastCompactionError = error instanceof Error ? error.message : String(error);
			refreshChrome(ctx);
			maybeNotifyPhaseChange(ctx);
			return;
		}
	});

	pi.on("session_compact", async (event, ctx) => {
		state.isCompacting = false;
		state.lastCompactionError = undefined;
		state.lastCompactionAt = Date.now();
		state.lastCompactionTurn = state.turnIndex;
		state.usageHistory = [];
		const compactionEntry = (event as { compactionEntry?: { id?: string } }).compactionEntry;
		if (compactionEntry?.id) {
			const label = `cmp/${state.compactionCounter + 1}`;
			state.compactionCounter += 1;
			addAutoLabel(ctx, compactionEntry.id, label);
		}
		refreshChrome(ctx);
	});

	pi.registerCommand("stability", {
		description: "Show stability status and context pressure",
		handler: async (_args, ctx) => {
			await refreshProjectContext(ctx);
			refreshChrome(ctx);
			await showPanel(ctx);
		},
	});

	pi.registerCommand("checkpoint", {
		description: "Create a manual stability checkpoint (usage: /checkpoint [label])",
		handler: async (args, ctx) => {
			const leafId = currentLeafId(ctx);
			const label = args.trim() ? `cp/${slugifyLabel(args)}` : undefined;
			appendCheckpoint(ctx, "manual", {
				label,
				note: args.trim() || "manual checkpoint",
				entryId: leafId,
			});
			if (leafId && label) pi.setLabel(leafId, label);
			if (ctx.hasUI) ctx.ui.notify(label ? `Checkpoint created: ${label}` : "Checkpoint created", "info");
			refreshChrome(ctx);
		},
	});

	pi.registerCommand("stability-compact", {
		description: "Compact with stability rules and optional extra instructions",
		handler: async (args, ctx) => {
			await runCompaction(ctx, {
				customInstructions: args.trim() || undefined,
				resumeAgentFlow: false,
			});
		},
	});
}
