import { spawn } from "node:child_process";
import { promises as fsp } from "node:fs";
import os from "node:os";
import path from "node:path";
import type {
	ExtensionAPI,
	ExtensionCommandContext,
	ExtensionContext,
} from "@mariozechner/pi-coding-agent";
import { Key, matchesKey, Text, truncateToWidth, visibleWidth } from "@mariozechner/pi-tui";
import { Type } from "@sinclair/typebox";

const WORKER_BYPASS_ENV = "PI_SUBAGENT_WORKER";
const SESSION_BYPASS_ENV = "PI_SUBAGENT_DISABLE";
const STATUS_ID = "delegated-subagents";
const WIDGET_ID = "delegated-subagents-monitor";
const RUN_ENTRY_TYPE = "delegated-subagents-run";
const AGENTS_DIR = path.join(process.env.PI_CODING_AGENT_DIR?.trim() || path.join(os.homedir(), ".pi", "agent"), "agents");

const WORKER_TOOLS = ["read", "bash", "edit", "write", "grep", "find", "ls"];
const MAX_PARALLEL = 4;
const HARD_MAX_PARALLEL = 8;
const WORKER_TIMEOUT_MS = 15 * 60 * 1000;
const MAX_RUN_HISTORY = 24;
const MAX_TIMELINE_ENTRIES = 18;
const MAX_LIVE_TEXT_CHARS = 4000;
const LIVE_UPDATE_INTERVAL_MS = 150;
const RECENT_WIDGET_WINDOW_MS = 10 * 60 * 1000;
const MAX_PERSISTED_TIMELINE_ENTRIES = 8;
const MAX_PERSISTED_OUTPUT_CHARS = 6000;
const MAX_PERSISTED_TASK_CHARS = 600;
const MONITOR_OVERLAY_MAX_HEIGHT = 24;
const LIST_PANEL_VISIBLE_ROWS = 10;
const DETAIL_MIN_SCROLL_ROWS = 6;
const DETAIL_PAGE_STEP = 8;

type UiContext = ExtensionContext | ExtensionCommandContext;

type WorkerTimelineKind = "status" | "tool" | "output" | "error";
type WorkerTimelineStatus = "running" | "ok" | "err";

type WorkerTimelineEntry = {
	timestamp: number;
	kind: WorkerTimelineKind;
	text: string;
	detail?: string;
	status?: WorkerTimelineStatus;
};

type WorkerTask = {
	label?: string;
	worker: string;
	task: string;
	cwd?: string;
};

type WorkerSpec = {
	name: string;
	description: string;
	tools: string[];
	model?: string;
	thinking?: string;
	systemPrompt: string;
};

type WorkerResult = {
	runId: string;
	label: string;
	worker: string;
	task: string;
	cwd: string;
	exitCode: number;
	output: string;
	error?: string;
	durationMs: number;
	liveText: string;
	activeTool?: string;
	lastEvent?: string;
	timeline: WorkerTimelineEntry[];
	startedAt: number;
	updatedAt: number;
	finishedAt?: number;
};

type ToolDetails = {
	mode: "single" | "parallel";
	results: WorkerResult[];
};

type PersistedWorkerRun = {
	version: 1;
	runId: string;
	label: string;
	worker: string;
	task: string;
	cwd: string;
	exitCode: number;
	output: string;
	error?: string;
	durationMs: number;
	lastEvent?: string;
	timeline: WorkerTimelineEntry[];
	startedAt: number;
	updatedAt: number;
	finishedAt?: number;
};

type MonitorState = {
	runs: WorkerResult[];
	runCounter: number;
	listeners: Set<() => void>;
	ctx?: UiContext;
};

const monitorState: MonitorState = {
	runs: [],
	runCounter: 0,
	listeners: new Set(),
};

const TaskSchema = Type.Object({
	label: Type.Optional(Type.String({ description: "Optional short label for this worker." })),
	worker: Type.String({ description: "Worker name from the global roster, such as scout, planner, researcher, worker, reviewer, or verifier." }),
	task: Type.String({ description: "Concrete objective for the worker." }),
	cwd: Type.Optional(Type.String({ description: "Optional working directory for the worker." })),
});

const ParamsSchema = Type.Object({
	label: Type.Optional(Type.String({ description: "Optional short label for the single worker." })),
	worker: Type.Optional(Type.String({ description: "Worker name from the global roster." })),
	task: Type.Optional(Type.String({ description: "Objective for one worker." })),
	tasks: Type.Optional(
		Type.Array(TaskSchema, {
			description: `Parallel worker objectives. Max ${HARD_MAX_PARALLEL}.`,
		}),
	),
	cwd: Type.Optional(Type.String({ description: "Optional working directory for the single worker." })),
});

function buildControllerPrompt(roster: WorkerSpec[]) {
	const lines = [
		"You are the user-facing orchestrator.",
		"You do not inspect files, run commands, edit code, browse docs, or verify behavior yourself.",
		"You talk to the user, decide what work is needed, delegate that work to workers, and synthesize the results.",
		"Use the subagent tool for all substantive work.",
		"Keep worker objectives narrow and concrete.",
		"Use multiple workers only for genuinely independent tasks.",
		"",
		"Single-worker tool shape:",
		'{ "worker": "planner", "task": "..." }',
		"",
		"Parallel tool shape:",
		'{ "tasks": [{ "worker": "scout", "task": "..." }, { "worker": "reviewer", "task": "..." }] }',
		"",
		"Available workers:",
	];
	for (const worker of roster) {
		lines.push(`- ${worker.name}: ${worker.description}`);
	}
	return lines.join("\n");
}

function buildWorkerPrompt(worker: WorkerSpec, cwd: string) {
	return [
		"You are a delegated worker.",
		"You are not the user-facing orchestrator.",
		`Assigned role: ${worker.name}`,
		`Role description: ${worker.description}`,
		"Execute the assigned task directly with the available tools.",
		"Stay inside the requested scope.",
		`Default working directory boundary: ${cwd}`,
		"Do not inspect or modify files outside that boundary unless the task explicitly requires it.",
		"If blocked, say exactly what blocked you.",
		"Finish with a concise final report.",
		"",
		worker.systemPrompt,
	].join("\n");
}

function getCurrentModelArg(ctx: any): string | undefined {
	return ctx.model?.provider && ctx.model?.id ? `${ctx.model.provider}/${ctx.model.id}` : undefined;
}

function getPiInvocation() {
	return {
		command: process.env.PI_SUBAGENT_PI_BIN || process.env.PI_BIN || "pi",
		args: [] as string[],
	};
}

function rememberUiContext(ctx: UiContext) {
	monitorState.ctx = ctx;
}

function subscribeMonitor(listener: () => void) {
	monitorState.listeners.add(listener);
	return () => {
		monitorState.listeners.delete(listener);
	};
}

function extractTextFromParts(parts: any[] | undefined): string {
	if (!Array.isArray(parts)) return "";
	return parts
		.filter((part) => part?.type === "text" && typeof part.text === "string")
		.map((part) => part.text)
		.join("\n")
		.trim();
}

function extractAssistantText(message: any): string {
	return extractTextFromParts(message?.content);
}

function extractToolResultText(value: any): string {
	if (!value) return "";
	if (Array.isArray(value.content)) return extractTextFromParts(value.content);
	if (Array.isArray(value.result?.content)) return extractTextFromParts(value.result.content);
	if (typeof value.text === "string") return value.text.trim();
	return "";
}

function appendCappedText(base: string, delta: string, maxChars: number) {
	const next = `${base}${delta}`;
	if (next.length <= maxChars) return next;
	return next.slice(next.length - maxChars);
}

function preview(text: string, max = 120): string {
	const singleLine = text.replace(/\s+/g, " ").trim();
	if (!singleLine) return "(no output)";
	return singleLine.length > max ? `${singleLine.slice(0, max)}...` : singleLine;
}

function truncateText(text: string, max: number): string {
	if (text.length <= max) return text;
	return `${text.slice(0, Math.max(0, max - 3))}...`;
}

function wrapPlainText(text: string, maxWidth: number, maxLines: number): string[] {
	const width = Math.max(12, maxWidth);
	const sourceLines = text.replace(/\r/g, "").split("\n");
	const lines: string[] = [];
	let truncated = false;

	for (const sourceLine of sourceLines) {
		if (sourceLine.length === 0) {
			lines.push("");
			if (lines.length >= maxLines) {
				truncated = true;
				break;
			}
			continue;
		}

		let remaining = sourceLine;
		while (remaining.length > width) {
			let cut = remaining.lastIndexOf(" ", width);
			if (cut < Math.floor(width * 0.5)) cut = width;
			lines.push(remaining.slice(0, cut).trimEnd());
			remaining = remaining.slice(cut).trimStart();
			if (lines.length >= maxLines) {
				truncated = true;
				break;
			}
		}
		if (truncated) break;
		lines.push(remaining);
		if (lines.length >= maxLines) {
			truncated = true;
			break;
		}
	}

	if (truncated && lines.length > 0) {
		const last = lines[Math.min(lines.length, maxLines) - 1];
		lines[Math.min(lines.length, maxLines) - 1] = last.length >= width ? `${last.slice(0, width - 1)}...` : `${last}...`;
	}

	return lines.slice(0, maxLines);
}

function shortenPath(rawPath: string): string {
	if (!rawPath) return ".";
	const home = os.homedir();
	return rawPath.startsWith(home) ? `~${rawPath.slice(home.length)}` : rawPath;
}

function formatPathLabel(rawPath: string, max = 52): string {
	const shortPath = shortenPath(rawPath);
	if (shortPath.length <= max) return shortPath;
	return `...${shortPath.slice(shortPath.length - max + 3)}`;
}

function formatDuration(durationMs: number): string {
	const totalSeconds = Math.max(1, Math.round(durationMs / 1000));
	if (totalSeconds < 60) return `${totalSeconds}s`;
	const minutes = Math.floor(totalSeconds / 60);
	const seconds = totalSeconds % 60;
	return seconds === 0 ? `${minutes}m` : `${minutes}m${seconds}s`;
}

function formatClock(timestamp: number): string {
	return new Date(timestamp).toLocaleTimeString("en-US", {
		hour12: false,
		hour: "2-digit",
		minute: "2-digit",
		second: "2-digit",
	});
}

function formatAge(timestamp: number | undefined): string {
	if (!timestamp) return "--";
	const delta = Math.max(0, Date.now() - timestamp);
	return formatDuration(delta);
}

function clampNumber(value: number, min: number, max: number): number {
	return Math.min(max, Math.max(min, value));
}

function formatStatusSummary(results: WorkerResult[]): string {
	if (results.length === 0) return "orch ready";
	const total = results.length;
	const running = results.filter((result) => result.exitCode === -1).length;
	const failed = results.filter((result) => result.exitCode > 0).length;
	const succeeded = results.filter((result) => result.exitCode === 0).length;
	if (running > 0) return `orch ${running}/${total} running`;
	if (failed > 0) return `orch ${succeeded}/${total} ok ${failed} err`;
	return total === 1 ? "orch worker ok" : `orch ${total}/${total} ok`;
}

function cloneTimelineEntry(entry: WorkerTimelineEntry): WorkerTimelineEntry {
	return { ...entry };
}

function cloneWorkerResult(result: WorkerResult): WorkerResult {
	return {
		...result,
		timeline: result.timeline.map(cloneTimelineEntry),
	};
}

function sanitizeTimeline(entries: unknown): WorkerTimelineEntry[] {
	if (!Array.isArray(entries)) return [];
	return entries
		.map((entry): WorkerTimelineEntry | undefined => {
			if (!entry || typeof entry !== "object") return undefined;
			const candidate = entry as Partial<WorkerTimelineEntry>;
			if (typeof candidate.timestamp !== "number" || typeof candidate.text !== "string" || typeof candidate.kind !== "string") return undefined;
			if (!["status", "tool", "output", "error"].includes(candidate.kind)) return undefined;
			const status =
				typeof candidate.status === "string" && ["running", "ok", "err"].includes(candidate.status)
					? (candidate.status as WorkerTimelineStatus)
					: undefined;
			return {
				timestamp: candidate.timestamp,
				kind: candidate.kind as WorkerTimelineKind,
				text: candidate.text,
				detail: typeof candidate.detail === "string" ? candidate.detail : undefined,
				status,
			};
		})
		.filter((entry): entry is WorkerTimelineEntry => Boolean(entry))
		.slice(-MAX_TIMELINE_ENTRIES);
}

function toPersistedRun(result: WorkerResult): PersistedWorkerRun {
	return {
		version: 1,
		runId: result.runId,
		label: result.label,
		worker: result.worker,
		task: truncateText(result.task, MAX_PERSISTED_TASK_CHARS),
		cwd: result.cwd,
		exitCode: result.exitCode,
		output: truncateText(result.output || result.liveText || "", MAX_PERSISTED_OUTPUT_CHARS),
		error: result.error ? truncateText(result.error, MAX_PERSISTED_OUTPUT_CHARS) : undefined,
		durationMs: result.durationMs,
		lastEvent: result.lastEvent ? truncateText(result.lastEvent, 240) : undefined,
		timeline: result.timeline.slice(-MAX_PERSISTED_TIMELINE_ENTRIES).map(cloneTimelineEntry),
		startedAt: result.startedAt,
		updatedAt: result.updatedAt,
		finishedAt: result.finishedAt,
	};
}

function fromPersistedRun(data: unknown): WorkerResult | undefined {
	if (!data || typeof data !== "object") return undefined;
	const candidate = data as Partial<PersistedWorkerRun>;
	if (
		typeof candidate.runId !== "string" ||
		typeof candidate.label !== "string" ||
		typeof candidate.worker !== "string" ||
		typeof candidate.task !== "string" ||
		typeof candidate.cwd !== "string" ||
		typeof candidate.exitCode !== "number" ||
		typeof candidate.output !== "string" ||
		typeof candidate.durationMs !== "number" ||
		typeof candidate.startedAt !== "number" ||
		typeof candidate.updatedAt !== "number"
	) {
		return undefined;
	}

	const timeline = sanitizeTimeline(candidate.timeline);
	return {
		runId: candidate.runId,
		label: candidate.label,
		worker: candidate.worker,
		task: candidate.task,
		cwd: candidate.cwd,
		exitCode: candidate.exitCode,
		output: candidate.output,
		error: typeof candidate.error === "string" ? candidate.error : undefined,
		durationMs: candidate.durationMs,
		liveText: candidate.output,
		activeTool: undefined,
		lastEvent:
			typeof candidate.lastEvent === "string"
				? candidate.lastEvent
				: timeline.length > 0
					? timeline[timeline.length - 1].detail
						? `${timeline[timeline.length - 1].text} | ${timeline[timeline.length - 1].detail}`
						: timeline[timeline.length - 1].text
					: undefined,
		timeline,
		startedAt: candidate.startedAt,
		updatedAt: candidate.updatedAt,
		finishedAt: typeof candidate.finishedAt === "number" ? candidate.finishedAt : undefined,
	};
}

function sortMonitorRuns() {
	monitorState.runs.sort((a, b) => b.updatedAt - a.updatedAt);
}

function getRunStartSequence(result: WorkerResult): number {
	const suffix = Number.parseInt(result.runId.split("-").pop() || "", 10);
	return Number.isFinite(suffix) ? suffix : 0;
}

function compareRunsByStartOrder(a: WorkerResult, b: WorkerResult): number {
	if (a.startedAt !== b.startedAt) return a.startedAt - b.startedAt;
	const sequenceDelta = getRunStartSequence(a) - getRunStartSequence(b);
	if (sequenceDelta !== 0) return sequenceDelta;
	return a.updatedAt - b.updatedAt;
}

function pruneMonitorRuns() {
	if (monitorState.runs.length > MAX_RUN_HISTORY) {
		monitorState.runs = monitorState.runs.slice(0, MAX_RUN_HISTORY);
	}
}

function getSortedRuns() {
	sortMonitorRuns();
	return monitorState.runs;
}

function getOverlayRuns() {
	return [...monitorState.runs].sort(compareRunsByStartOrder);
}

function getInitialOverlaySelection(runs: WorkerResult[]): string | undefined {
	if (runs.length === 0) return undefined;
	const firstActive = runs.find((run) => run.exitCode === -1);
	return firstActive?.runId || runs[runs.length - 1]?.runId;
}

function getActiveRuns() {
	return getSortedRuns().filter((result) => result.exitCode === -1);
}

function getLatestCompletedRun() {
	return getSortedRuns().find((result) => result.exitCode !== -1);
}

function getStatusRuns() {
	const active = getActiveRuns();
	if (active.length > 0) return active;
	const latest = getLatestCompletedRun();
	return latest ? [latest] : [];
}

function createWorkerResult(task: WorkerTask, worker: WorkerSpec, index: number, defaultCwd: string): WorkerResult {
	const now = Date.now();
	const label = task.label?.trim() || `worker-${index + 1}`;
	const cwd = task.cwd || defaultCwd;
	return {
		runId: `run-${now}-${++monitorState.runCounter}`,
		label,
		worker: worker.name,
		task: task.task,
		cwd,
		exitCode: -1,
		output: "",
		error: undefined,
		durationMs: 0,
		liveText: "",
		activeTool: undefined,
		lastEvent: "starting",
		timeline: [
			{
				timestamp: now,
				kind: "status",
				text: "worker started",
				detail: preview(task.task, 120),
				status: "running",
			},
		],
		startedAt: now,
		updatedAt: now,
		finishedAt: undefined,
	};
}

function upsertRun(result: WorkerResult) {
	const next = cloneWorkerResult(result);
	const index = monitorState.runs.findIndex((run) => run.runId === next.runId);
	if (index === -1) monitorState.runs.unshift(next);
	else monitorState.runs[index] = next;
	sortMonitorRuns();
	pruneMonitorRuns();
}

function addTimelineEntry(result: WorkerResult, entry: WorkerTimelineEntry) {
	result.timeline.push(entry);
	if (result.timeline.length > MAX_TIMELINE_ENTRIES) {
		result.timeline.splice(0, result.timeline.length - MAX_TIMELINE_ENTRIES);
	}
	result.lastEvent = entry.detail ? `${entry.text} | ${entry.detail}` : entry.text;
	result.updatedAt = entry.timestamp;
}

function formatToolInvocation(toolName: string, args: Record<string, any> | undefined): string {
	const source = args || {};
	const location = typeof source.path === "string" ? source.path : typeof source.file_path === "string" ? source.file_path : "";
	switch (toolName) {
		case "read": {
			const start = typeof source.offset === "number" ? source.offset : undefined;
			const limit = typeof source.limit === "number" ? source.limit : undefined;
			const range =
				start !== undefined ? `:${start}${limit !== undefined && limit > 0 ? `-${start + limit - 1}` : ""}` : "";
			return `read ${formatPathLabel(location || ".", 42)}${range}`;
		}
		case "write":
			return `write ${formatPathLabel(location || ".", 42)}`;
		case "edit":
			return `edit ${formatPathLabel(location || ".", 42)}`;
		case "ls":
			return `ls ${formatPathLabel((typeof source.path === "string" ? source.path : ".") || ".", 42)}`;
		case "find":
			return `find ${preview(typeof source.pattern === "string" ? source.pattern : "*", 24)} in ${formatPathLabel((typeof source.path === "string" ? source.path : ".") || ".", 28)}`;
		case "grep":
			return `grep ${preview(typeof source.pattern === "string" ? source.pattern : "", 24)} in ${formatPathLabel((typeof source.path === "string" ? source.path : ".") || ".", 28)}`;
		case "bash":
			return `bash ${preview(typeof source.command === "string" ? source.command : "", 60)}`;
		case "web-search":
			return `web ${preview(typeof source.q === "string" ? source.q : typeof source.query === "string" ? source.query : "", 56)}`;
		case "scrape":
			return `scrape ${preview(typeof source.url === "string" ? source.url : "", 56)}`;
		default:
			return `${toolName} ${preview(JSON.stringify(source), 60)}`;
	}
}

function formatToolOutcome(result: any, isError: boolean): string {
	const text = extractToolResultText(result);
	if (isError) return preview(text || "tool failed", 120);
	return preview(text || "tool completed", 120);
}

function summarizeRun(result: WorkerResult, max = 96): string {
	if (result.exitCode === -1) {
		return preview(result.activeTool || result.liveText || result.lastEvent || "running", max);
	}
	if (result.error) return preview(result.error, max);
	return preview(result.output || result.liveText || result.lastEvent || "(no output)", max);
}

function renderWorkerStatusToken(theme: any, result: WorkerResult) {
	if (result.exitCode === -1) return theme.fg("warning", "RUN");
	if (result.exitCode === 0) return theme.fg("success", "OK");
	return theme.fg("error", "ERR");
}

function renderWorkerSummary(theme: any, result: WorkerResult): string {
	const cwdLabel = path.basename(result.cwd) || result.cwd;
	return [
		`${renderWorkerStatusToken(theme, result)} ${theme.fg("accent", result.label)}`,
		result.label !== result.worker ? theme.fg("muted", `(${result.worker})`) : "",
		theme.fg("border", "│"),
		theme.fg("muted", cwdLabel),
		theme.fg("border", "│"),
		theme.fg("dim", formatDuration(result.durationMs)),
	].filter(Boolean).join(" ");
}

function buildWidgetLines(ctx: UiContext, width: number): string[] {
	const theme = ctx.ui.theme;
	const active = getActiveRuns();
	const latest = getLatestCompletedRun();
	const showLatest = latest && Date.now() - (latest.finishedAt || latest.updatedAt) <= RECENT_WIDGET_WINDOW_MS ? latest : undefined;

	const lines = [
		`${theme.fg("toolTitle", theme.bold("ORCH MONITOR"))}${theme.fg("border", " ─ ")}${theme.fg("accent", active.length > 0 ? `${active.length} live` : showLatest ? "recent" : "idle")} ${theme.fg("dim", "/subagents")}`,
	];

	if (active.length > 0) {
		for (const run of active.slice(0, 2)) {
			lines.push(`${renderWorkerStatusToken(theme, run)} ${theme.fg("accent", run.label)} ${theme.fg("border", "│")} ${theme.fg("dim", summarizeRun(run, 72))}`);
		}
		if (active.length > 2) {
			lines.push(theme.fg("muted", `... +${active.length - 2} more running`));
		}
	} else if (showLatest) {
		lines.push(`${renderWorkerStatusToken(theme, showLatest)} ${theme.fg("accent", showLatest.label)} ${theme.fg("border", "│")} ${theme.fg("dim", summarizeRun(showLatest, 72))}`);
		lines.push(theme.fg("muted", `finished ${formatAge(showLatest.finishedAt)} ago`));
	}

	return lines.map((line) => truncateToWidth(line, width));
}

function mountMonitorWidget(ctx: UiContext) {
	if (!ctx.hasUI) return;
	const active = getActiveRuns();
	const latest = getLatestCompletedRun();
	const showLatest = latest && Date.now() - (latest.finishedAt || latest.updatedAt) <= RECENT_WIDGET_WINDOW_MS;
	if (active.length === 0 && !showLatest) {
		ctx.ui.setWidget(WIDGET_ID, undefined);
		return;
	}

	ctx.ui.setWidget(
		WIDGET_ID,
		() => ({
			render(width: number) {
				return buildWidgetLines(ctx, width);
			},
			invalidate() {},
		}),
		{ placement: "belowEditor" },
	);
}

function setOrchestratorStatus(ctx: UiContext) {
	if (!ctx.hasUI) return;
	ctx.ui.setStatus(STATUS_ID, formatStatusSummary(getStatusRuns()));
}

function refreshMonitorChrome() {
	const ctx = monitorState.ctx;
	if (!ctx?.hasUI) return;
	setOrchestratorStatus(ctx);
	mountMonitorWidget(ctx);
}

function notifyMonitorListeners() {
	for (const listener of monitorState.listeners) listener();
}

function publishMonitor() {
	refreshMonitorChrome();
	notifyMonitorListeners();
}

function restorePersistedRuns(ctx: ExtensionContext) {
	const restored = new Map<string, WorkerResult>();
	for (const entry of ctx.sessionManager.getBranch()) {
		if (entry.type !== "custom" || entry.customType !== RUN_ENTRY_TYPE) continue;
		const run = fromPersistedRun(entry.data);
		if (!run) continue;
		restored.set(run.runId, run);
	}
	monitorState.runs = Array.from(restored.values())
		.sort((a, b) => b.updatedAt - a.updatedAt)
		.slice(0, MAX_RUN_HISTORY);
}

function persistCompletedRun(pi: ExtensionAPI, result: WorkerResult) {
	if (result.exitCode === -1) return;
	pi.appendEntry<PersistedWorkerRun>(RUN_ENTRY_TYPE, toPersistedRun(result));
}

function renderTimelineLine(theme: any, entry: WorkerTimelineEntry, width: number): string {
	const statusColor =
		entry.status === "err" ? "error" : entry.status === "ok" ? "success" : entry.kind === "tool" ? "warning" : "muted";
	const line = `${theme.fg("dim", formatClock(entry.timestamp))} ${theme.fg("border", "│")} ${theme.fg(statusColor, entry.text)}${entry.detail ? `${theme.fg("border", " │ ")}${theme.fg("dim", entry.detail)}` : ""}`;
	return truncateToWidth(line, width);
}

function padPanelLine(text: string, width: number): string {
	return truncateToWidth(text, width, "...", true);
}

function framePanel(theme: any, width: number, title: string, lines: string[]): string[] {
	const innerWidth = Math.max(24, width - 2);
	const border = (text: string) => theme.fg("border", text);
	const titleLabel = truncateToWidth(` ${title} `, innerWidth);
	const titleFill = Math.max(0, innerWidth - visibleWidth(titleLabel));
	const framed = [border("╭") + theme.fg("toolTitle", theme.bold(titleLabel)) + border(`${"─".repeat(titleFill)}╮`)];

	for (const line of lines) {
		framed.push(border("│") + padPanelLine(line, innerWidth) + border("│"));
	}

	framed.push(border(`╰${"─".repeat(innerWidth)}╯`));
	return framed;
}

function buildFooterBar(theme: any, width: number, left: string, right: string): string {
	const leftWidth = visibleWidth(left);
	const rightWidth = visibleWidth(right);
	if (leftWidth === 0) return truncateToWidth(right, width, "...", true);
	if (rightWidth === 0) return truncateToWidth(left, width, "...", true);
	if (leftWidth + 1 + rightWidth <= width) {
		return `${left}${" ".repeat(Math.max(1, width - leftWidth - rightWidth))}${right}`;
	}

	const reservedRight = Math.min(rightWidth, Math.max(12, Math.floor(width * 0.45)));
	const leftBudget = Math.max(0, width - reservedRight - 1);
	const leftText = truncateToWidth(left, leftBudget);
	const rightText = truncateToWidth(right, Math.max(0, width - visibleWidth(leftText) - 1));
	return truncateToWidth(`${leftText} ${rightText}`, width, "...", true);
}

function getVisibleRunWindow(runs: WorkerResult[], selectedRunId: string | undefined, maxVisible: number) {
	if (runs.length <= maxVisible) {
		return {
			start: 0,
			end: runs.length,
			selectedIndex: selectedRunId ? runs.findIndex((run) => run.runId === selectedRunId) : 0,
			visible: runs,
		};
	}

	const selectedIndex = Math.max(0, runs.findIndex((run) => run.runId === selectedRunId));
	const half = Math.floor(maxVisible / 2);
	const maxStart = Math.max(0, runs.length - maxVisible);
	const start = Math.min(Math.max(0, selectedIndex - half), maxStart);
	const end = Math.min(runs.length, start + maxVisible);
	return {
		start,
		end,
		selectedIndex,
		visible: runs.slice(start, end),
	};
}

function buildListPanelLines(theme: any, width: number, runs: WorkerResult[], selectedRunId: string | undefined): string[] {
	const innerWidth = Math.max(24, width - 2);
	const lines: string[] = [];
	lines.push(truncateToWidth(`${theme.fg("accent", "list view")} ${theme.fg("border", "│")} ${theme.fg("muted", `${runs.filter((run) => run.exitCode === -1).length} live`)} ${theme.fg("border", "│")} ${theme.fg("muted", `${runs.length} tracked`)}`, innerWidth));
	lines.push(truncateToWidth(theme.fg("dim", "Inspect a worker run to follow timeline, active tool, and live/final output."), innerWidth));
	lines.push("");

	if (runs.length === 0) {
		lines.push(truncateToWidth(theme.fg("dim", "No worker runs yet."), innerWidth));
		lines.push("");
		lines.push(buildFooterBar(theme, innerWidth, "", theme.fg("dim", "Esc close")));
		return framePanel(theme, width, "ORCH MONITOR", lines);
	}

	const windowed = getVisibleRunWindow(runs, selectedRunId, LIST_PANEL_VISIBLE_ROWS);
	for (const run of windowed.visible) {
		const selected = run.runId === selectedRunId;
		const marker = selected ? theme.fg("accent", "›") : theme.fg("dim", "·");
		const workerTag = run.label !== run.worker ? `${run.label} (${run.worker})` : run.label;
		const summary = summarizeRun(run, 72);
		const summaryColor = selected ? "text" : "dim";
		lines.push(
			truncateToWidth(
				`${marker} ${renderWorkerStatusToken(theme, run)} ${theme.fg("accent", workerTag)} ${theme.fg("border", "│")} ${theme.fg("muted", formatDuration(run.durationMs))} ${theme.fg("border", "│")} ${theme.fg(summaryColor, summary)}`,
				innerWidth,
			),
		);
	}
	lines.push("");
	const listStatus =
		runs.length > windowed.visible.length
			? theme.fg("muted", `showing ${windowed.start + 1}-${windowed.end}/${runs.length}`)
			: theme.fg("muted", `selected ${windowed.selectedIndex + 1}/${runs.length}`);
	lines.push(buildFooterBar(theme, innerWidth, listStatus, theme.fg("dim", "↑↓ move  Enter open  Esc close")));
	return framePanel(theme, width, "ORCH MONITOR", lines);
}

function buildDetailPanelLines(theme: any, width: number, run: WorkerResult, scrollOffset: number): { lines: string[]; maxScrollOffset: number } {
	const innerWidth = Math.max(24, width - 2);
	const statusWord = run.exitCode === -1 ? "running" : run.exitCode === 0 ? "completed" : "failed";
	const source = run.error || run.output || run.liveText || "(no output yet)";
	const taskLines = wrapPlainText(run.task, Math.max(18, innerWidth - 4), 2);
	const headerLines: string[] = [];

	headerLines.push(
		truncateToWidth(
			`${renderWorkerStatusToken(theme, run)} ${theme.fg("accent", run.label)} ${run.label !== run.worker ? theme.fg("muted", `(${run.worker})`) : ""} ${theme.fg("border", "│")} ${theme.fg("text", statusWord)} ${theme.fg("border", "│")} ${theme.fg("dim", formatDuration(run.durationMs))}`,
			innerWidth,
		),
	);
	headerLines.push(truncateToWidth(`${theme.fg("muted", "cwd")} ${theme.fg("text", formatPathLabel(run.cwd, Math.max(24, innerWidth - 10)))}`, innerWidth));
	headerLines.push(truncateToWidth(`${theme.fg("muted", "updated")} ${theme.fg("dim", formatAge(run.updatedAt))} ${theme.fg("border", "│")} ${theme.fg("muted", "started")} ${theme.fg("dim", formatClock(run.startedAt))}`, innerWidth));
	headerLines.push(truncateToWidth(theme.fg("muted", "task"), innerWidth));
	for (const line of taskLines) {
		headerLines.push(truncateToWidth(`  ${theme.fg("text", line)}`, innerWidth));
	}
	if (run.activeTool) {
		headerLines.push(truncateToWidth(`${theme.fg("muted", "active")} ${theme.fg("warning", run.activeTool)}`, innerWidth));
	}

	const scrollableLines: string[] = [];
	scrollableLines.push(truncateToWidth(theme.fg("muted", "timeline"), innerWidth));
	for (const entry of run.timeline) {
		scrollableLines.push(renderTimelineLine(theme, entry, innerWidth));
	}
	scrollableLines.push("");
	scrollableLines.push(truncateToWidth(theme.fg("muted", run.exitCode === -1 ? "live text" : run.error ? "error" : "final output"), innerWidth));
	for (const line of wrapPlainText(source, Math.max(18, innerWidth - 4), Number.MAX_SAFE_INTEGER)) {
		scrollableLines.push(truncateToWidth(`  ${theme.fg(run.error ? "error" : "text", line)}`, innerWidth));
	}

	const visibleScrollRows = Math.max(DETAIL_MIN_SCROLL_ROWS, MONITOR_OVERLAY_MAX_HEIGHT - 2 - headerLines.length - 1);
	const maxScrollOffset = Math.max(0, scrollableLines.length - visibleScrollRows);
	const clampedOffset = clampNumber(scrollOffset, 0, maxScrollOffset);
	const visibleScrollLines = scrollableLines.slice(clampedOffset, clampedOffset + visibleScrollRows);
	const lines = [...headerLines, ...visibleScrollLines];

	while (lines.length < headerLines.length + visibleScrollRows) {
		lines.push("");
	}

	const scrollRangeStart = scrollableLines.length === 0 ? 0 : clampedOffset + 1;
	const scrollRangeEnd = Math.min(scrollableLines.length, clampedOffset + visibleScrollRows);
	const detailStatus = theme.fg(
		"muted",
		maxScrollOffset > 0 ? `body ${scrollRangeStart}-${scrollRangeEnd}/${scrollableLines.length}` : `body ${scrollableLines.length} lines`,
	);
	lines.push(
		buildFooterBar(theme, innerWidth, detailStatus, theme.fg("dim", "↑↓ scroll  PgUp/PgDn page  [ ] worker  Esc back")),
	);

	return {
		lines: framePanel(theme, width, "WORKER DETAIL", lines),
		maxScrollOffset,
	};
}

async function showMonitorOverlay(ctx: UiContext) {
	if (!ctx.hasUI) return;

	let mode: "list" | "detail" = "list";
	let selectedRunId = getInitialOverlaySelection(getOverlayRuns());
	let detailScrollOffset = 0;
	let lastRenderWidth = 96;

	function resolveSelection(runs: WorkerResult[]) {
		if (runs.length === 0) {
			selectedRunId = undefined;
			return undefined;
		}
		if (!selectedRunId || !runs.some((run) => run.runId === selectedRunId)) {
			selectedRunId = runs[0].runId;
		}
		return runs.find((run) => run.runId === selectedRunId);
	}

	await ctx.ui.custom(
		(tui, theme, _keybindings, done) => {
			const unsubscribe = subscribeMonitor(() => {
				resolveSelection(getOverlayRuns());
				tui.requestRender();
			});

			return {
				dispose() {
					unsubscribe();
				},
				invalidate() {},
				render(width: number) {
					lastRenderWidth = width;
					const runs = getOverlayRuns();
					const selected = resolveSelection(runs);
					if (mode === "detail" && selected) {
						const detailView = buildDetailPanelLines(theme, width, selected, detailScrollOffset);
						detailScrollOffset = clampNumber(detailScrollOffset, 0, detailView.maxScrollOffset);
						return detailView.lines;
					}
					return buildListPanelLines(theme, width, runs, selectedRunId);
				},
				handleInput(data: string) {
					const runs = getOverlayRuns();
					const selected = resolveSelection(runs);
					const index = selected ? runs.findIndex((run) => run.runId === selected.runId) : -1;

					if (mode === "detail") {
						if (matchesKey(data, Key.left) || matchesKey(data, Key.escape) || matchesKey(data, Key.backspace)) {
							mode = "list";
							detailScrollOffset = 0;
							tui.requestRender();
							return;
						}
						if (!selected) return;
						const detailView = buildDetailPanelLines(theme, lastRenderWidth, selected, detailScrollOffset);
						if (matchesKey(data, Key.up) && detailScrollOffset > 0) {
							detailScrollOffset -= 1;
							tui.requestRender();
							return;
						}
						if (matchesKey(data, Key.down) && detailScrollOffset < detailView.maxScrollOffset) {
							detailScrollOffset += 1;
							tui.requestRender();
							return;
						}
						if (matchesKey(data, Key.pageUp) && detailScrollOffset > 0) {
							detailScrollOffset = Math.max(0, detailScrollOffset - DETAIL_PAGE_STEP);
							tui.requestRender();
							return;
						}
						if (matchesKey(data, Key.pageDown) && detailScrollOffset < detailView.maxScrollOffset) {
							detailScrollOffset = Math.min(detailView.maxScrollOffset, detailScrollOffset + DETAIL_PAGE_STEP);
							tui.requestRender();
							return;
						}
						if (matchesKey(data, Key.home) && detailScrollOffset !== 0) {
							detailScrollOffset = 0;
							tui.requestRender();
							return;
						}
						if (matchesKey(data, Key.end) && detailScrollOffset !== detailView.maxScrollOffset) {
							detailScrollOffset = detailView.maxScrollOffset;
							tui.requestRender();
							return;
						}
						if ((matchesKey(data, Key.leftbracket) || matchesKey(data, Key.ctrl("p"))) && index > 0) {
							selectedRunId = runs[index - 1].runId;
							detailScrollOffset = 0;
							tui.requestRender();
							return;
						}
						if ((matchesKey(data, Key.rightbracket) || matchesKey(data, Key.ctrl("n"))) && index >= 0 && index < runs.length - 1) {
							selectedRunId = runs[index + 1].runId;
							detailScrollOffset = 0;
							tui.requestRender();
							return;
						}
						return;
					}

					if (matchesKey(data, Key.escape)) {
						done(undefined);
						return;
					}
						if (matchesKey(data, Key.up) && index > 0) {
							selectedRunId = runs[index - 1].runId;
							tui.requestRender();
							return;
						}
						if (matchesKey(data, Key.down) && index >= 0 && index < runs.length - 1) {
							selectedRunId = runs[index + 1].runId;
							tui.requestRender();
							return;
						}
						if ((matchesKey(data, Key.enter) || matchesKey(data, Key.right)) && selected) {
							mode = "detail";
							detailScrollOffset = 0;
							tui.requestRender();
						}
					},
					};
				},
			{
				overlay: true,
				overlayOptions: {
					anchor: "center",
					width: 96,
					minWidth: 72,
					maxHeight: MONITOR_OVERLAY_MAX_HEIGHT,
					margin: 1,
					offsetY: -1,
				},
		},
	);
}

function parseFrontmatterFile(text: string): { meta: Record<string, string>; body: string } {
	const match = text.match(/^---\s*\r?\n([\s\S]*?)\r?\n---\s*\r?\n?([\s\S]*)$/);
	if (!match) return { meta: {}, body: text.trim() };
	const meta: Record<string, string> = {};
	for (const line of match[1].split(/\r?\n/)) {
		const separator = line.indexOf(":");
		if (separator === -1) continue;
		const key = line.slice(0, separator).trim();
		const value = line.slice(separator + 1).trim();
		if (!key) continue;
		meta[key] = value;
	}
	return { meta, body: match[2].trim() };
}

async function loadWorkerRoster(): Promise<WorkerSpec[]> {
	let entries: string[] = [];
	try {
		entries = await fsp.readdir(AGENTS_DIR);
	} catch {
		return [];
	}

	const workers: WorkerSpec[] = [];
	for (const entry of entries.filter((name) => name.endsWith(".md")).sort()) {
		const filePath = path.join(AGENTS_DIR, entry);
		let text = "";
		try {
			text = await fsp.readFile(filePath, "utf8");
		} catch {
			continue;
		}
		const { meta, body } = parseFrontmatterFile(text);
		if (!meta.name || !meta.description || !body) continue;
		workers.push({
			name: meta.name,
			description: meta.description,
			tools: meta.tools ? meta.tools.split(",").map((item) => item.trim()).filter(Boolean) : WORKER_TOOLS,
			model: meta.model || undefined,
			thinking: meta.thinking || undefined,
			systemPrompt: body,
		});
	}
	return workers;
}

function listWorkerNames(roster: WorkerSpec[]) {
	return roster.map((worker) => worker.name).join(", ");
}

function getWorkerSpec(roster: WorkerSpec[], name: string): WorkerSpec | undefined {
	return roster.find((worker) => worker.name === name);
}

async function writeTempPrompt(text: string) {
	const dir = await fsp.mkdtemp(path.join(os.tmpdir(), "pi-subagent-"));
	const filePath = path.join(dir, "system.md");
	await fsp.writeFile(filePath, text, { encoding: "utf8", mode: 0o600 });
	return { dir, filePath };
}

async function cleanupTempPrompt(temp: { dir: string; filePath: string } | null) {
	if (!temp) return;
	await fsp.unlink(temp.filePath).catch(() => undefined);
	await fsp.rmdir(temp.dir).catch(() => undefined);
}

async function mapWithConcurrencyLimit<TIn, TOut>(
	items: TIn[],
	concurrency: number,
	fn: (item: TIn, index: number) => Promise<TOut>,
): Promise<TOut[]> {
	if (items.length === 0) return [];
	const limit = Math.max(1, Math.min(concurrency, items.length));
	const results = new Array<TOut>(items.length);
	let nextIndex = 0;
	const workers = new Array(limit).fill(null).map(async () => {
		while (true) {
			const index = nextIndex++;
			if (index >= items.length) return;
			results[index] = await fn(items[index], index);
		}
	});
	await Promise.all(workers);
	return results;
}

async function runWorker(
	result: WorkerResult,
	worker: WorkerSpec,
	defaultModel: string | undefined,
	defaultThinking: string | undefined,
	signal: AbortSignal | undefined,
	onProgress?: (partial: WorkerResult) => void,
): Promise<WorkerResult> {
	const promptFile = await writeTempPrompt(buildWorkerPrompt(worker, result.cwd));
	const invocation = getPiInvocation();
	const tools = worker.tools.length > 0 ? worker.tools : WORKER_TOOLS;
	const model = worker.model || defaultModel;
	const thinking = worker.thinking || defaultThinking;
	const args = [
		...invocation.args,
		"--mode",
		"json",
		"-p",
		"--no-session",
		"--append-system-prompt",
		promptFile.filePath,
		"--tools",
		tools.join(","),
	];
	if (model) args.push("--model", model);
	if (thinking && thinking !== "off") args.push("--thinking", thinking);
	args.push(result.task);

	const startedAt = result.startedAt;
	const toolLabels = new Map<string, string>();
	let lastEmitAt = 0;

	const emit = (force = false) => {
		result.durationMs = Date.now() - startedAt;
		result.updatedAt = Date.now();
		if (!onProgress) return;
		if (!force && result.updatedAt - lastEmitAt < LIVE_UPDATE_INTERVAL_MS) return;
		lastEmitAt = result.updatedAt;
		onProgress(cloneWorkerResult(result));
	};

	try {
		await new Promise<void>((resolve, reject) => {
			const proc = spawn(invocation.command, args, {
				cwd: result.cwd,
				shell: false,
				stdio: ["ignore", "pipe", "pipe"],
				env: {
					...process.env,
					[WORKER_BYPASS_ENV]: "1",
					[SESSION_BYPASS_ENV]: "1",
					PI_SKIP_VERSION_CHECK: "1",
				},
			});

			let buffer = "";
			let stderr = "";
			let settled = false;
			let timeout: NodeJS.Timeout | undefined;
			let abortHandler: (() => void) | undefined;

			const finish = (error?: Error) => {
				if (settled) return;
				settled = true;
				if (timeout) clearTimeout(timeout);
				if (signal && abortHandler) signal.removeEventListener("abort", abortHandler);
				if (error) reject(error);
				else resolve();
			};

			const stop = (message: string) => {
				if (!result.error) result.error = message;
				addTimelineEntry(result, {
					timestamp: Date.now(),
					kind: "error",
					text: "worker interrupted",
					detail: preview(message, 120),
					status: "err",
				});
				emit(true);
				proc.kill("SIGTERM");
				const killTimer = setTimeout(() => {
					if (proc.exitCode === null) proc.kill("SIGKILL");
				}, 5000);
				killTimer.unref?.();
			};

			const processLine = (line: string) => {
				if (!line.trim()) return;
				let event: any;
				try {
					event = JSON.parse(line);
				} catch {
					return;
				}

				if (event.type === "tool_execution_start") {
					const label = formatToolInvocation(event.toolName, event.args);
					toolLabels.set(event.toolCallId, label);
					result.activeTool = label;
					addTimelineEntry(result, {
						timestamp: Date.now(),
						kind: "tool",
						text: label,
						status: "running",
					});
					emit();
					return;
				}

				if (event.type === "tool_execution_end") {
					const label = toolLabels.get(event.toolCallId) || formatToolInvocation(event.toolName, undefined);
					if (result.activeTool === label) result.activeTool = undefined;
					addTimelineEntry(result, {
						timestamp: Date.now(),
						kind: event.isError ? "error" : "tool",
						text: label,
						detail: formatToolOutcome(event.result, Boolean(event.isError)),
						status: event.isError ? "err" : "ok",
					});
					emit();
					return;
				}

				if (event.type === "message_update" && event.message?.role === "assistant") {
					const assistantEventType = event.assistantMessageEvent?.type;
					if (assistantEventType === "text_delta" && typeof event.assistantMessageEvent?.delta === "string") {
						result.liveText = appendCappedText(result.liveText, event.assistantMessageEvent.delta, MAX_LIVE_TEXT_CHARS);
						emit();
					}
					return;
				}

				if (event.type === "message_end" && event.message?.role === "assistant") {
					const text = extractAssistantText(event.message);
					if (text) {
						result.output = text;
						result.liveText = text;
						addTimelineEntry(result, {
							timestamp: Date.now(),
							kind: "output",
							text: "assistant response",
							detail: preview(text, 140),
							status: "ok",
						});
					}
					if (event.message?.errorMessage) {
						result.error = event.message.errorMessage;
						addTimelineEntry(result, {
							timestamp: Date.now(),
							kind: "error",
							text: "assistant error",
							detail: preview(event.message.errorMessage, 140),
							status: "err",
						});
					}
					emit(true);
				}
			};

			proc.stdout.on("data", (chunk) => {
				buffer += chunk.toString("utf8");
				const lines = buffer.split("\n");
				buffer = lines.pop() || "";
				for (const line of lines) processLine(line);
			});

			proc.stderr.on("data", (chunk) => {
				stderr += chunk.toString("utf8");
			});

			proc.on("error", (error) => {
				result.exitCode = 1;
				result.error = result.error || error.message;
				result.finishedAt = Date.now();
				addTimelineEntry(result, {
					timestamp: result.finishedAt,
					kind: "error",
					text: "worker process error",
					detail: preview(result.error, 140),
					status: "err",
				});
				emit(true);
				finish(error);
			});

			proc.on("close", (code, closeSignal) => {
				if (buffer.trim()) processLine(buffer);
				result.durationMs = Date.now() - startedAt;
				result.updatedAt = Date.now();
				result.finishedAt = result.updatedAt;
				result.exitCode = code ?? 0;
				if (closeSignal && !result.error) result.error = `Worker exited via signal ${closeSignal}`;
				if (result.exitCode !== 0 && !result.error) result.error = stderr.trim() || `Worker exited with code ${result.exitCode}`;

				if (result.error) {
					addTimelineEntry(result, {
						timestamp: result.finishedAt,
						kind: "error",
						text: "worker failed",
						detail: preview(result.error, 140),
						status: "err",
					});
				} else {
					addTimelineEntry(result, {
						timestamp: result.finishedAt,
						kind: "status",
						text: "worker completed",
						detail: preview(result.output || result.liveText || "(no output)", 140),
						status: "ok",
					});
				}

				emit(true);
				finish();
			});

			timeout = setTimeout(() => {
				stop("Worker timed out.");
			}, WORKER_TIMEOUT_MS);
			timeout.unref?.();

			if (signal) {
				abortHandler = () => stop("Worker aborted by orchestrator.");
				if (signal.aborted) abortHandler();
				else signal.addEventListener("abort", abortHandler, { once: true });
			}
		});
	} finally {
		await cleanupTempPrompt(promptFile);
	}

	return result;
}

function summarizeParallel(results: WorkerResult[]) {
	const done = results.filter((result) => result.exitCode !== -1).length;
	const succeeded = results.filter((result) => result.exitCode === 0).length;
	const lines = [`Parallel workers: ${succeeded}/${results.length} succeeded`];
	if (done !== results.length) lines[0] += `, ${results.length - done} running`;
	for (const result of results) {
		lines.push(`- ${result.label}: ${summarizeRun(result, 120)}`);
	}
	return lines.join("\n");
}

export default function delegatedSubagents(pi: ExtensionAPI) {
	if (process.env[WORKER_BYPASS_ENV] === "1" || process.env[SESSION_BYPASS_ENV] === "1") return;

	pi.on("session_start", async (_event, ctx) => {
		rememberUiContext(ctx);
		restorePersistedRuns(ctx);
		pi.setActiveTools(["subagent"]);
		setOrchestratorStatus(ctx);
		mountMonitorWidget(ctx);
	});

	pi.on("model_select", async (_event, ctx) => {
		rememberUiContext(ctx);
		refreshMonitorChrome();
	});

	pi.on("before_agent_start", async (event) => {
		const roster = await loadWorkerRoster();
		return {
			systemPrompt: `${event.systemPrompt}\n\n${buildControllerPrompt(roster)}`,
		};
	});

	pi.registerCommand("workers", {
		description: "Show available global worker roles",
		handler: async (_args, ctx) => {
			rememberUiContext(ctx);
			const roster = await loadWorkerRoster();
			if (roster.length === 0) {
				if (ctx.hasUI) ctx.ui.notify(`No workers found in ${AGENTS_DIR}`, "warning");
				return;
			}
			const lines = roster.map((worker) => `${worker.name} - ${worker.description}`);
			if (ctx.hasUI) ctx.ui.notify(lines.join("\n"), "info");
		},
	});

	pi.registerCommand("subagents", {
		description: "Open live and recent worker monitor",
		handler: async (_args, ctx) => {
			rememberUiContext(ctx);
			await showMonitorOverlay(ctx);
		},
	});

	pi.registerTool({
		name: "subagent",
		label: "Subagent",
		description: "Delegate actual work to isolated worker processes. The primary session stays user-facing and orchestration-only.",
		promptSnippet: "Use subagent for all real work.",
		promptGuidelines: [
			"Do not claim you inspected files, ran commands, edited code, or verified behavior yourself.",
			"Delegate real work to workers.",
			"Keep each worker task narrow and concrete.",
		],
		parameters: ParamsSchema,

		async execute(_toolCallId, params, signal, onUpdate, ctx) {
			rememberUiContext(ctx);

			const roster = await loadWorkerRoster();
			if (roster.length === 0) {
				return {
					content: [{ type: "text", text: `No workers found in ${AGENTS_DIR}.` }],
					details: { mode: "single", results: [] } satisfies ToolDetails,
					isError: true,
				};
			}

			const hasSingle = typeof params.task === "string" && params.task.trim().length > 0;
			const hasParallel = Array.isArray(params.tasks) && params.tasks.length > 0;

			if (Number(hasSingle) + Number(hasParallel) !== 1) {
				return {
					content: [{ type: "text", text: "Provide either `task` or `tasks`." }],
					details: { mode: "single", results: [] } satisfies ToolDetails,
					isError: true,
				};
			}

			const model = getCurrentModelArg(ctx);
			const thinking = pi.getThinkingLevel();

			if (hasSingle) {
				const workerName = typeof params.worker === "string" && params.worker.trim() ? params.worker.trim() : "worker";
				const worker = getWorkerSpec(roster, workerName);
				if (!worker) {
					return {
						content: [{ type: "text", text: `Unknown worker: ${workerName}. Available workers: ${listWorkerNames(roster)}.` }],
						details: { mode: "single", results: [] } satisfies ToolDetails,
						isError: true,
					};
				}

				const task: WorkerTask = {
					label: params.label,
					worker: worker.name,
					task: params.task,
					cwd: params.cwd,
				};
				const current = createWorkerResult(task, worker, 0, ctx.cwd);
				upsertRun(current);
				publishMonitor();

				const emitSingleUpdate = () => {
					onUpdate?.({
						content: [
							{
								type: "text",
								text: current.error ? `Worker failed: ${current.error}` : current.output || current.liveText || current.lastEvent || "(running...)",
							},
						],
						details: { mode: "single", results: [cloneWorkerResult(current)] },
					});
				};

				emitSingleUpdate();

				try {
					const result = await runWorker(current, worker, model, thinking, signal, (partial) => {
						upsertRun(partial);
						publishMonitor();
						onUpdate?.({
							content: [
								{
									type: "text",
									text: partial.error ? `Worker failed: ${partial.error}` : partial.output || partial.liveText || partial.lastEvent || "(running...)",
								},
							],
							details: { mode: "single", results: [cloneWorkerResult(partial)] },
						});
					});
					upsertRun(result);
					persistCompletedRun(pi, result);
					publishMonitor();
					return {
						content: [{ type: "text", text: result.error ? `Worker failed: ${result.error}` : result.output || "(no output)" }],
						details: { mode: "single", results: [cloneWorkerResult(result)] } satisfies ToolDetails,
						isError: result.exitCode !== 0,
					};
				} catch (error: any) {
					publishMonitor();
					throw error;
				}
			}

			if ((params.tasks as WorkerTask[]).length > HARD_MAX_PARALLEL) {
				return {
					content: [{ type: "text", text: `Too many parallel workers. Max is ${HARD_MAX_PARALLEL}.` }],
					details: { mode: "parallel", results: [] } satisfies ToolDetails,
					isError: true,
				};
			}

			const resolvedTasks: Array<{ task: WorkerTask; worker: WorkerSpec; result: WorkerResult }> = [];
			for (const [index, item] of (params.tasks as WorkerTask[]).entries()) {
				const workerName = item.worker?.trim() || "worker";
				const worker = getWorkerSpec(roster, workerName);
				if (!worker) {
					return {
						content: [{ type: "text", text: `Unknown worker: ${workerName}. Available workers: ${listWorkerNames(roster)}.` }],
						details: { mode: "parallel", results: [] } satisfies ToolDetails,
						isError: true,
					};
				}
				const task: WorkerTask = {
					label: item.label,
					worker: worker.name,
					task: item.task,
					cwd: item.cwd,
				};
				const result = createWorkerResult(task, worker, index, ctx.cwd);
				resolvedTasks.push({ task, worker, result });
				upsertRun(result);
			}
			publishMonitor();

			const emitParallelUpdate = () => {
				const snapshots = resolvedTasks.map((item) => cloneWorkerResult(item.result));
				const running = snapshots.filter((result) => result.exitCode === -1).length;
				const done = snapshots.filter((result) => result.exitCode !== -1).length;
				onUpdate?.({
					content: [{ type: "text", text: `Parallel: ${done}/${snapshots.length} done, ${running} running...` }],
					details: { mode: "parallel", results: snapshots },
				});
			};

			emitParallelUpdate();

			try {
				const results = await mapWithConcurrencyLimit(
					resolvedTasks,
					Math.min(MAX_PARALLEL, resolvedTasks.length),
					async (item) => {
						const result = await runWorker(item.result, item.worker, model, thinking, signal, (partial) => {
							item.result = partial;
							upsertRun(partial);
							publishMonitor();
							emitParallelUpdate();
						});
						item.result = result;
						upsertRun(result);
						persistCompletedRun(pi, result);
						publishMonitor();
						emitParallelUpdate();
						return result;
					},
				);

				const allSucceeded = results.every((result) => result.exitCode === 0);
				return {
					content: [{ type: "text", text: summarizeParallel(results) }],
					details: { mode: "parallel", results: results.map(cloneWorkerResult) } satisfies ToolDetails,
					isError: !allSucceeded,
				};
			} catch (error: any) {
				publishMonitor();
				throw error;
			}
		},

		renderCall(args, theme) {
			if (Array.isArray(args.tasks) && args.tasks.length > 0) {
				const lines = [
					`${theme.fg("toolTitle", theme.bold("ORCH"))}${theme.fg("border", " ─ ")}${theme.fg("accent", `parallel x${args.tasks.length}`)}`,
				];
				for (const task of args.tasks.slice(0, 3)) {
					const label = task.label || task.worker || "worker";
					lines.push(`${theme.fg("muted", label)} ${theme.fg("border", "│")} ${theme.fg("accent", task.worker || "worker")} ${theme.fg("border", "│")} ${theme.fg("dim", preview(task.task, 64))}`);
				}
				if (args.tasks.length > 3) lines.push(theme.fg("muted", `... +${args.tasks.length - 3} more`));
				return new Text(lines.join("\n"), 0, 0);
			}

			return new Text(
				[
					`${theme.fg("toolTitle", theme.bold("ORCH"))}${theme.fg("border", " ─ ")}${theme.fg("accent", args.worker || "worker")}`,
					`${theme.fg("muted", "task")} ${theme.fg("border", "│")} ${theme.fg("dim", preview(args.task || "", 84))}`,
				].join("\n"),
				0,
				0,
			);
		},

		renderResult(result, _context, theme) {
			const details = result.details as ToolDetails | undefined;
			if (!details || details.results.length === 0) {
				const first = result.content[0];
				return new Text(first?.type === "text" ? first.text : "(no output)", 0, 0);
			}

			if (details.mode === "single") {
				const worker = details.results[0];
				const activityLine = worker.activeTool
					? `${theme.fg("muted", "tool")} ${theme.fg("border", "│")} ${theme.fg("warning", worker.activeTool)}`
					: worker.lastEvent
						? `${theme.fg("muted", "last")} ${theme.fg("border", "│")} ${theme.fg("dim", preview(worker.lastEvent, 160))}`
						: "";
				const body = summarizeRun(worker, 220);
				return new Text(
					[
						`${theme.fg("toolTitle", theme.bold("WORKER"))}${theme.fg("border", " ─ ")}${theme.fg("accent", worker.label)}`,
						renderWorkerSummary(theme, worker),
						activityLine,
						theme.fg(worker.exitCode > 0 ? "error" : "text", body),
						theme.fg("dim", worker.exitCode === -1 ? "live /subagents for timeline" : "/subagents for history"),
					].filter(Boolean).join("\n"),
					0,
					0,
				);
			}

			const total = details.results.length;
			const succeeded = details.results.filter((worker) => worker.exitCode === 0).length;
			const lines = [
				`${theme.fg("toolTitle", theme.bold("ORCH"))}${theme.fg("border", " ─ ")}${theme.fg("accent", `parallel ${succeeded}/${total}`)}`,
			];
			for (const worker of details.results) {
				lines.push(renderWorkerSummary(theme, worker));
				lines.push(theme.fg("dim", summarizeRun(worker, 180)));
			}
			lines.push(theme.fg("dim", details.results.some((worker) => worker.exitCode === -1) ? "live /subagents for timeline" : "/subagents for history"));
			return new Text(lines.join("\n"), 0, 0);
		},
	});
}
