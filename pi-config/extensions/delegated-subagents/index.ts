/**
 * Subagent Tool - Delegate tasks to specialized agents
 *
 * Spawns a separate `pi` process for each subagent invocation,
 * giving it an isolated context window.
 *
 * Supports three modes:
 *   - Single: { agent: "name", task: "..." }
 *   - Parallel: { tasks: [{ agent: "name", task: "..." }, ...] }
 *   - Chain: { chain: [{ agent: "name", task: "... {previous} ..." }, ...] }
 *
 * Uses JSON mode to capture structured output from subagents.
 */

import { spawn } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { AgentToolResult } from "@mariozechner/pi-agent-core";
import type { Message } from "@mariozechner/pi-ai";
import { StringEnum } from "@mariozechner/pi-ai";
import { type ExtensionAPI, getMarkdownTheme, withFileMutationQueue } from "@mariozechner/pi-coding-agent";
import { Container, Markdown, Spacer, Text } from "@mariozechner/pi-tui";
import { Type } from "@sinclair/typebox";
import { type AgentConfig, type AgentScope, discoverAgents } from "./agents.js";

const WORKER_BYPASS_ENV = "PI_SUBAGENT_WORKER";
const SESSION_BYPASS_ENV = "PI_SUBAGENT_DISABLE";
const MAX_PARALLEL_TASKS = 8;
const MAX_CONCURRENCY = 4;
const COLLAPSED_ITEM_COUNT = 10;
const HARD_MAX_TURNS = 64;
const HARD_MAX_TOOL_CALLS = 128;
const HARD_MAX_DURATION_SECONDS = 1800;

type AgentLimits = {
	maxTurns: number;
	maxToolCalls: number;
	maxDurationSeconds: number;
};

const DEFAULT_AGENT_LIMITS: Record<string, AgentLimits> = {
	scout: { maxTurns: 6, maxToolCalls: 8, maxDurationSeconds: 60 },
	planner: { maxTurns: 8, maxToolCalls: 10, maxDurationSeconds: 90 },
	researcher: { maxTurns: 14, maxToolCalls: 18, maxDurationSeconds: 180 },
	verifier: { maxTurns: 12, maxToolCalls: 18, maxDurationSeconds: 420 },
	reviewer: { maxTurns: 8, maxToolCalls: 10, maxDurationSeconds: 90 },
	worker: { maxTurns: 16, maxToolCalls: 24, maxDurationSeconds: 300 },
};

const FALLBACK_AGENT_LIMITS: AgentLimits = { maxTurns: 10, maxToolCalls: 12, maxDurationSeconds: 120 };

function getCurrentModelArg(ctx: any): string | undefined {
	return ctx.model?.provider && ctx.model?.id ? `${ctx.model.provider}/${ctx.model.id}` : undefined;
}

function buildDelegationInstructions() {
	return [
		"Delegated execution mode is active.",
		"You are the main conversational/orchestrator agent.",
		"Do not claim to have personally read files, run commands, edited code, searched the web, or executed verification.",
		"For any repo work, shell work, code changes, web/doc research, testing, or verification, use the subagent tool.",
		"Prefer self-contained delegated tasks over micromanaging one command at a time.",
		"Use roles intentionally:",
		"- scout: always cheap and quick for fast repo reconnaissance only",
		"- planner: implementation planning only",
		"- researcher: repo-first deep analysis, with web/docs only when needed",
		"- worker: general implementation and execution",
		"- verifier: spec-based, user-like validation with proof",
		"- reviewer: read-only review and risk assessment",
		"For simple repo-summary questions, do one scout pass first.",
		"Do not run overlapping scout tasks for the same summary question.",
		"If the task is deep, exhaustive, multi-phase, or needs external docs/current info, use researcher instead of scout.",
		"Researcher should start from local repo evidence and use web tools only when local evidence is insufficient or current/external docs are required.",
		"Every subagent call has turn, tool-call, and time budgets. Start small and only expand if there is a concrete reason.",
		"Use parallel tasks when independent work can happen concurrently.",
		"Use chain mode when one agent's output should feed the next.",
		"After subagents return, synthesize their findings for the user and decide next steps.",
	].join("\n");
}

function assertPositiveInt(name: string, value: number, hardMax: number) {
	if (!Number.isInteger(value) || value <= 0) {
		throw new Error(`${name} must be a positive integer`);
	}
	if (value > hardMax) {
		throw new Error(`${name} exceeds hard limit ${hardMax}`);
	}
}

function resolveAgentLimits(agentName: string, overrides?: Partial<AgentLimits>): AgentLimits {
	const defaults = DEFAULT_AGENT_LIMITS[agentName] || FALLBACK_AGENT_LIMITS;
	const limits = {
		maxTurns: overrides?.maxTurns ?? defaults.maxTurns,
		maxToolCalls: overrides?.maxToolCalls ?? defaults.maxToolCalls,
		maxDurationSeconds: overrides?.maxDurationSeconds ?? defaults.maxDurationSeconds,
	};
	assertPositiveInt("maxTurns", limits.maxTurns, HARD_MAX_TURNS);
	assertPositiveInt("maxToolCalls", limits.maxToolCalls, HARD_MAX_TOOL_CALLS);
	assertPositiveInt("maxDurationSeconds", limits.maxDurationSeconds, HARD_MAX_DURATION_SECONDS);
	return limits;
}

function formatTokens(count: number): string {
	if (count < 1000) return count.toString();
	if (count < 10000) return `${(count / 1000).toFixed(1)}k`;
	if (count < 1000000) return `${Math.round(count / 1000)}k`;
	return `${(count / 1000000).toFixed(1)}M`;
}

function formatUsageStats(
	usage: {
		input: number;
		output: number;
		cacheRead: number;
		cacheWrite: number;
		cost: number;
		contextTokens?: number;
		turns?: number;
	},
	model?: string,
): string {
	const parts: string[] = [];
	if (usage.turns) parts.push(`${usage.turns} turn${usage.turns > 1 ? "s" : ""}`);
	if (usage.input) parts.push(`↑${formatTokens(usage.input)}`);
	if (usage.output) parts.push(`↓${formatTokens(usage.output)}`);
	if (usage.cacheRead) parts.push(`R${formatTokens(usage.cacheRead)}`);
	if (usage.cacheWrite) parts.push(`W${formatTokens(usage.cacheWrite)}`);
	if (usage.cost) parts.push(`$${usage.cost.toFixed(4)}`);
	if (usage.contextTokens && usage.contextTokens > 0) {
		parts.push(`ctx:${formatTokens(usage.contextTokens)}`);
	}
	if (model) parts.push(model);
	return parts.join(" ");
}

function formatDurationMs(durationMs: number | undefined): string {
	if (!durationMs || durationMs <= 0) return "0s";
	const totalSeconds = Math.max(1, Math.round(durationMs / 1000));
	if (totalSeconds < 60) return `${totalSeconds}s`;
	const minutes = Math.floor(totalSeconds / 60);
	const seconds = totalSeconds % 60;
	return seconds === 0 ? `${minutes}m` : `${minutes}m${seconds}s`;
}

function formatLimitStats(result: {
	turnsUsed: number;
	maxTurns: number;
	toolCallsUsed: number;
	maxToolCalls: number;
	durationMs: number;
	maxDurationSeconds: number;
}): string {
	return `turns:${result.turnsUsed}/${result.maxTurns} tools:${result.toolCallsUsed}/${result.maxToolCalls} time:${formatDurationMs(result.durationMs)}/${result.maxDurationSeconds}s`;
}

function looksLikeDeepAnalysisTask(task: string): boolean {
	return /\b(in[ -]?depth|deep|exhaustive|comprehensive|full architecture|full analysis|trace all|thorough|detailed analysis|broad investigation|multi-phase)\b/i.test(
		task,
	);
}

function looksLikeBroadRepoOverviewTask(task: string): boolean {
	return /\b(repo|repository|project|codebase)\b/i.test(task) && /\b(overview|summary|what is|what does it do|main components|layout|tour|high-level)\b/i.test(task);
}

function normalizeTaskWords(task: string): string[] {
	return task
		.toLowerCase()
		.replace(/[^a-z0-9\s]+/g, " ")
		.split(/\s+/)
		.filter((word) => word.length >= 4)
		.filter((word) => !new Set(["that", "this", "with", "from", "into", "about", "quickly", "please", "return", "using", "should", "their", "there"]).has(word));
}

function taskSimilarity(a: string, b: string): number {
	const aSet = new Set(normalizeTaskWords(a));
	const bSet = new Set(normalizeTaskWords(b));
	if (aSet.size === 0 || bSet.size === 0) return 0;
	let overlap = 0;
	for (const word of aSet) if (bSet.has(word)) overlap += 1;
	const union = new Set([...aSet, ...bSet]).size;
	return union === 0 ? 0 : overlap / union;
}

function formatToolCall(
	toolName: string,
	args: Record<string, unknown>,
	themeFg: (color: any, text: string) => string,
): string {
	const shortenPath = (p: string) => {
		const home = os.homedir();
		return p.startsWith(home) ? `~${p.slice(home.length)}` : p;
	};

	switch (toolName) {
		case "bash": {
			const command = (args.command as string) || "...";
			const preview = command.length > 60 ? `${command.slice(0, 60)}...` : command;
			return themeFg("muted", "$ ") + themeFg("toolOutput", preview);
		}
		case "read": {
			const rawPath = (args.file_path || args.path || "...") as string;
			const filePath = shortenPath(rawPath);
			const offset = args.offset as number | undefined;
			const limit = args.limit as number | undefined;
			let text = themeFg("accent", filePath);
			if (offset !== undefined || limit !== undefined) {
				const startLine = offset ?? 1;
				const endLine = limit !== undefined ? startLine + limit - 1 : "";
				text += themeFg("warning", `:${startLine}${endLine ? `-${endLine}` : ""}`);
			}
			return themeFg("muted", "read ") + text;
		}
		case "write": {
			const rawPath = (args.file_path || args.path || "...") as string;
			const filePath = shortenPath(rawPath);
			const content = (args.content || "") as string;
			const lines = content.split("\n").length;
			let text = themeFg("muted", "write ") + themeFg("accent", filePath);
			if (lines > 1) text += themeFg("dim", ` (${lines} lines)`);
			return text;
		}
		case "edit": {
			const rawPath = (args.file_path || args.path || "...") as string;
			return themeFg("muted", "edit ") + themeFg("accent", shortenPath(rawPath));
		}
		case "ls": {
			const rawPath = (args.path || ".") as string;
			return themeFg("muted", "ls ") + themeFg("accent", shortenPath(rawPath));
		}
		case "find": {
			const pattern = (args.pattern || "*") as string;
			const rawPath = (args.path || ".") as string;
			return themeFg("muted", "find ") + themeFg("accent", pattern) + themeFg("dim", ` in ${shortenPath(rawPath)}`);
		}
		case "grep": {
			const pattern = (args.pattern || "") as string;
			const rawPath = (args.path || ".") as string;
			return (
				themeFg("muted", "grep ") +
				themeFg("accent", `/${pattern}/`) +
				themeFg("dim", ` in ${shortenPath(rawPath)}`)
			);
		}
		default: {
			const argsStr = JSON.stringify(args);
			const preview = argsStr.length > 50 ? `${argsStr.slice(0, 50)}...` : argsStr;
			return themeFg("accent", toolName) + themeFg("dim", ` ${preview}`);
		}
	}
}

interface UsageStats {
	input: number;
	output: number;
	cacheRead: number;
	cacheWrite: number;
	cost: number;
	contextTokens: number;
	turns: number;
}

interface SingleResult {
	agent: string;
	agentSource: "user" | "project" | "unknown";
	task: string;
	exitCode: number;
	messages: Message[];
	stderr: string;
	usage: UsageStats;
	model?: string;
	stopReason?: string;
	errorMessage?: string;
	step?: number;
	maxTurns: number;
	maxToolCalls: number;
	maxDurationSeconds: number;
	toolCallsUsed: number;
	durationMs: number;
}

interface SubagentDetails {
	mode: "single" | "parallel" | "chain";
	agentScope: AgentScope;
	projectAgentsDir: string | null;
	results: SingleResult[];
}

function getFinalOutput(messages: Message[]): string {
	for (let i = messages.length - 1; i >= 0; i--) {
		const msg = messages[i];
		if (msg.role === "assistant") {
			for (const part of msg.content) {
				if (part.type === "text") return part.text;
			}
		}
	}
	return "";
}

type DisplayItem = { type: "text"; text: string } | { type: "toolCall"; name: string; args: Record<string, any> };

function getDisplayItems(messages: Message[]): DisplayItem[] {
	const items: DisplayItem[] = [];
	for (const msg of messages) {
		if (msg.role === "assistant") {
			for (const part of msg.content) {
				if (part.type === "text") items.push({ type: "text", text: part.text });
				else if (part.type === "toolCall") items.push({ type: "toolCall", name: part.name, args: part.arguments });
			}
		}
	}
	return items;
}

async function mapWithConcurrencyLimit<TIn, TOut>(
	items: TIn[],
	concurrency: number,
	fn: (item: TIn, index: number) => Promise<TOut>,
): Promise<TOut[]> {
	if (items.length === 0) return [];
	const limit = Math.max(1, Math.min(concurrency, items.length));
	const results: TOut[] = new Array(items.length);
	let nextIndex = 0;
	const workers = new Array(limit).fill(null).map(async () => {
		while (true) {
			const current = nextIndex++;
			if (current >= items.length) return;
			results[current] = await fn(items[current], current);
		}
	});
	await Promise.all(workers);
	return results;
}

async function writePromptToTempFile(agentName: string, prompt: string): Promise<{ dir: string; filePath: string }> {
	const tmpDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "pi-subagent-"));
	const safeName = agentName.replace(/[^\w.-]+/g, "_");
	const filePath = path.join(tmpDir, `prompt-${safeName}.md`);
	await withFileMutationQueue(filePath, async () => {
		await fs.promises.writeFile(filePath, prompt, { encoding: "utf-8", mode: 0o600 });
	});
	return { dir: tmpDir, filePath };
}

function getPiInvocation(args: string[]): { command: string; args: string[] } {
	const currentScript = process.argv[1];
	if (currentScript && fs.existsSync(currentScript)) {
		return { command: process.execPath, args: [currentScript, ...args] };
	}

	const execName = path.basename(process.execPath).toLowerCase();
	const isGenericRuntime = /^(node|bun)(\.exe)?$/.test(execName);
	if (!isGenericRuntime) {
		return { command: process.execPath, args };
	}

	return { command: "pi", args };
}

type OnUpdateCallback = (partial: AgentToolResult<SubagentDetails>) => void;

type RuntimeOptions = {
	modelArg?: string;
	thinkingLevel?: string;
};

function countAssistantToolCalls(message: Message): number {
	if (message.role !== "assistant") return 0;
	return message.content.filter((part) => part.type === "toolCall").length;
}

async function runSingleAgent(
	defaultCwd: string,
	agents: AgentConfig[],
	agentName: string,
	task: string,
	cwd: string | undefined,
	step: number | undefined,
	limitsOverride: Partial<AgentLimits> | undefined,
	signal: AbortSignal | undefined,
	onUpdate: OnUpdateCallback | undefined,
	makeDetails: (results: SingleResult[]) => SubagentDetails,
	runtimeOptions: RuntimeOptions = {},
): Promise<SingleResult> {
	const agent = agents.find((a) => a.name === agentName);

	if (!agent) {
		const available = agents.map((a) => `"${a.name}"`).join(", ") || "none";
		return {
			agent: agentName,
			agentSource: "unknown",
			task,
			exitCode: 1,
			messages: [],
			stderr: `Unknown agent: "${agentName}". Available agents: ${available}.`,
			usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0, contextTokens: 0, turns: 0 },
			step,
			maxTurns: 0,
			maxToolCalls: 0,
			maxDurationSeconds: 0,
			toolCallsUsed: 0,
			durationMs: 0,
		};
	}

	const limits = resolveAgentLimits(agentName, limitsOverride);
	const selectedModel = agent.inheritRuntimeModel === false ? agent.model || runtimeOptions.modelArg : runtimeOptions.modelArg || agent.model;
	const selectedThinking =
		agent.inheritRuntimeThinking === false
			? agent.thinking || runtimeOptions.thinkingLevel
			: runtimeOptions.thinkingLevel || agent.thinking;
	const args: string[] = ["--mode", "json", "-p", "--no-session"];
	if (selectedModel) args.push("--model", selectedModel);
	if (selectedThinking) args.push("--thinking", selectedThinking);
	if (agent.tools && agent.tools.length > 0) args.push("--tools", agent.tools.join(","));

	let tmpPromptDir: string | null = null;
	let tmpPromptPath: string | null = null;
	const startedAt = Date.now();
	let wasAborted = false;
	let forcedStopReason: string | undefined;
	let forcedErrorMessage: string | undefined;

	const currentResult: SingleResult = {
		agent: agentName,
		agentSource: agent.source,
		task,
		exitCode: 0,
		messages: [],
		stderr: "",
		usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0, contextTokens: 0, turns: 0 },
		model: selectedModel,
		step,
		maxTurns: limits.maxTurns,
		maxToolCalls: limits.maxToolCalls,
		maxDurationSeconds: limits.maxDurationSeconds,
		toolCallsUsed: 0,
		durationMs: 0,
	};

	const emitUpdate = () => {
		currentResult.durationMs = Date.now() - startedAt;
		if (onUpdate) {
			onUpdate({
				content: [{ type: "text", text: getFinalOutput(currentResult.messages) || "(running...)" }],
				details: makeDetails([currentResult]),
			});
		}
	};

	try {
		if (agent.systemPrompt.trim()) {
			const tmp = await writePromptToTempFile(agent.name, agent.systemPrompt);
			tmpPromptDir = tmp.dir;
			tmpPromptPath = tmp.filePath;
			args.push("--append-system-prompt", tmpPromptPath);
		}

		args.push(`Task: ${task}`);

		const exitCode = await new Promise<number>((resolve) => {
			const invocation = getPiInvocation(args);
			const proc = spawn(invocation.command, invocation.args, {
				cwd: cwd ?? defaultCwd,
				shell: false,
				stdio: ["ignore", "pipe", "pipe"],
				env: {
					...process.env,
					[WORKER_BYPASS_ENV]: "1",
					KILN_ACTOR_KIND: "worker",
					PI_SKIP_VERSION_CHECK: "1",
				},
			});
			let buffer = "";
			let settled = false;
			let budgetTimer: NodeJS.Timeout | undefined;
			let abortHandler: (() => void) | undefined;

			const finish = (code: number) => {
				if (settled) return;
				settled = true;
				if (budgetTimer) clearTimeout(budgetTimer);
				if (signal && abortHandler) signal.removeEventListener("abort", abortHandler);
				resolve(code);
			};

			const stopProc = (reason: "aborted" | "error", message: string) => {
				if (forcedStopReason) return;
				forcedStopReason = reason;
				forcedErrorMessage = message;
				currentResult.stopReason = reason;
				currentResult.errorMessage = message;
				currentResult.durationMs = Date.now() - startedAt;
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

				if (event.type === "message_end" && event.message) {
					const msg = event.message as Message;
					currentResult.messages.push(msg);

					if (msg.role === "assistant") {
						currentResult.usage.turns++;
						currentResult.toolCallsUsed += countAssistantToolCalls(msg);
						const usage = msg.usage;
						if (usage) {
							currentResult.usage.input += usage.input || 0;
							currentResult.usage.output += usage.output || 0;
							currentResult.usage.cacheRead += usage.cacheRead || 0;
							currentResult.usage.cacheWrite += usage.cacheWrite || 0;
							currentResult.usage.cost += usage.cost?.total || 0;
							currentResult.usage.contextTokens = usage.totalTokens || 0;
						}
						if (!currentResult.model && msg.model) currentResult.model = msg.model;
						if (msg.stopReason) currentResult.stopReason = msg.stopReason;
						if (msg.errorMessage) currentResult.errorMessage = msg.errorMessage;
						currentResult.durationMs = Date.now() - startedAt;
						if (currentResult.usage.turns > currentResult.maxTurns) {
							stopProc(
								"error",
								`Budget exceeded: turns ${currentResult.usage.turns}/${currentResult.maxTurns}. Use researcher for deeper analysis.`,
							);
						} else if (currentResult.toolCallsUsed > currentResult.maxToolCalls) {
							stopProc(
								"error",
								`Budget exceeded: tool calls ${currentResult.toolCallsUsed}/${currentResult.maxToolCalls}. Use researcher or worker if the task truly needs more depth.`,
							);
						}
					}
					emitUpdate();
				}

				if (event.type === "tool_result_end" && event.message) {
					currentResult.messages.push(event.message as Message);
					emitUpdate();
				}
			};

			proc.stdout.on("data", (data) => {
				buffer += data.toString();
				const lines = buffer.split("\n");
				buffer = lines.pop() || "";
				for (const line of lines) processLine(line);
			});

			proc.stderr.on("data", (data) => {
				currentResult.stderr += data.toString();
			});

			proc.on("close", (code, closeSignal) => {
				if (buffer.trim()) processLine(buffer);
				currentResult.durationMs = Date.now() - startedAt;
				if (forcedStopReason || forcedErrorMessage) {
					finish(code ?? 124);
					return;
				}
				if (closeSignal) {
					currentResult.stopReason = currentResult.stopReason || "error";
					currentResult.errorMessage = currentResult.errorMessage || `Subagent exited via signal ${closeSignal}`;
					finish(code ?? 128);
					return;
				}
				finish(code ?? 0);
			});

			proc.on("error", (error) => {
				currentResult.stopReason = currentResult.stopReason || "error";
				currentResult.errorMessage = currentResult.errorMessage || error.message;
				finish(1);
			});

			budgetTimer = setTimeout(() => {
				stopProc(
					"error",
					`Budget exceeded: duration ${formatDurationMs(Date.now() - startedAt)}/${currentResult.maxDurationSeconds}s. Use researcher or worker if the task truly needs more depth.`,
				);
			}, currentResult.maxDurationSeconds * 1000);
			budgetTimer.unref?.();

			if (signal) {
				abortHandler = () => {
					wasAborted = true;
					stopProc("aborted", "Subagent was aborted by the caller");
				};
				if (signal.aborted) abortHandler();
				else signal.addEventListener("abort", abortHandler, { once: true });
			}
		});

		currentResult.durationMs = Date.now() - startedAt;
		currentResult.exitCode = exitCode;
		if (forcedStopReason && !currentResult.stopReason) currentResult.stopReason = forcedStopReason;
		if (forcedErrorMessage && !currentResult.errorMessage) currentResult.errorMessage = forcedErrorMessage;
		if (wasAborted) throw new Error("Subagent was aborted");
		return currentResult;
	} finally {
		if (tmpPromptPath)
			try {
				fs.unlinkSync(tmpPromptPath);
			} catch {
				/* ignore */
			}
		if (tmpPromptDir)
			try {
				fs.rmdirSync(tmpPromptDir);
			} catch {
				/* ignore */
			}
	}
}

const TaskItem = Type.Object({
	agent: Type.String({ description: "Name of the agent to invoke" }),
	task: Type.String({ description: "Task to delegate to the agent" }),
	cwd: Type.Optional(Type.String({ description: "Working directory for the agent process" })),
	maxTurns: Type.Optional(Type.Integer({ minimum: 1, description: `Turn budget override. Defaults per role, hard max ${HARD_MAX_TURNS}.` })),
	maxToolCalls: Type.Optional(
		Type.Integer({ minimum: 1, description: `Tool-call budget override. Defaults per role, hard max ${HARD_MAX_TOOL_CALLS}.` }),
	),
	maxDurationSeconds: Type.Optional(
		Type.Integer({ minimum: 1, description: `Time budget override in seconds. Defaults per role, hard max ${HARD_MAX_DURATION_SECONDS}.` }),
	),
});

const ChainItem = Type.Object({
	agent: Type.String({ description: "Name of the agent to invoke" }),
	task: Type.String({ description: "Task with optional {previous} placeholder for prior output" }),
	cwd: Type.Optional(Type.String({ description: "Working directory for the agent process" })),
	maxTurns: Type.Optional(Type.Integer({ minimum: 1, description: `Turn budget override. Defaults per role, hard max ${HARD_MAX_TURNS}.` })),
	maxToolCalls: Type.Optional(
		Type.Integer({ minimum: 1, description: `Tool-call budget override. Defaults per role, hard max ${HARD_MAX_TOOL_CALLS}.` }),
	),
	maxDurationSeconds: Type.Optional(
		Type.Integer({ minimum: 1, description: `Time budget override in seconds. Defaults per role, hard max ${HARD_MAX_DURATION_SECONDS}.` }),
	),
});

const AgentScopeSchema = StringEnum(["user", "project", "both"] as const, {
	description: 'Which agent directories to use. Default: "user". Use "both" to include project-local agents.',
	default: "user",
});

const SubagentParams = Type.Object({
	agent: Type.Optional(Type.String({ description: "Name of the agent to invoke (for single mode)" })),
	task: Type.Optional(Type.String({ description: "Task to delegate (for single mode)" })),
	tasks: Type.Optional(Type.Array(TaskItem, { description: "Array of {agent, task} for parallel execution" })),
	chain: Type.Optional(Type.Array(ChainItem, { description: "Array of {agent, task} for sequential execution" })),
	agentScope: Type.Optional(AgentScopeSchema),
	confirmProjectAgents: Type.Optional(
		Type.Boolean({ description: "Prompt before running project-local agents. Default: true.", default: true }),
	),
	cwd: Type.Optional(Type.String({ description: "Working directory for the agent process (single mode)" })),
	maxTurns: Type.Optional(Type.Integer({ minimum: 1, description: `Turn budget override. Defaults per role, hard max ${HARD_MAX_TURNS}.` })),
	maxToolCalls: Type.Optional(
		Type.Integer({ minimum: 1, description: `Tool-call budget override. Defaults per role, hard max ${HARD_MAX_TOOL_CALLS}.` }),
	),
	maxDurationSeconds: Type.Optional(
		Type.Integer({ minimum: 1, description: `Time budget override in seconds. Defaults per role, hard max ${HARD_MAX_DURATION_SECONDS}.` }),
	),
});

type RequestedTask = {
	agent: string;
	task: string;
	cwd?: string;
	maxTurns?: number;
	maxToolCalls?: number;
	maxDurationSeconds?: number;
};

function validateRequestedTasks(mode: "single" | "parallel" | "chain", requests: RequestedTask[]): string | undefined {
	for (const request of requests) {
		try {
			resolveAgentLimits(request.agent, request);
		} catch (error) {
			return `Invalid budget for ${request.agent}: ${(error as Error).message}.`;
		}
		if (request.agent === "scout" && looksLikeDeepAnalysisTask(request.task)) {
			return `Scout is reserved for cheap, quick reconnaissance. Use researcher for in-depth analysis instead.`;
		}
	}

	if (mode === "parallel") {
		const scoutOverviewTasks = requests.filter(
			(request) => request.agent === "scout" && looksLikeBroadRepoOverviewTask(request.task),
		);
		if (scoutOverviewTasks.length > 1) {
			return "Do not run overlapping scout overview tasks in parallel. Use one scout pass, then escalate to researcher only if a concrete gap remains.";
		}

		for (let i = 0; i < requests.length; i++) {
			for (let j = i + 1; j < requests.length; j++) {
				if (requests[i].agent !== requests[j].agent) continue;
				if (taskSimilarity(requests[i].task, requests[j].task) >= 0.55) {
					return `Parallel ${requests[i].agent} tasks overlap too much. Split the work into clearly distinct scopes or run a single task first.`;
				}
			}
		}
	}

	return undefined;
}

function createPlaceholderResult(task: RequestedTask): SingleResult {
	const limits = resolveAgentLimits(task.agent, task);
	return {
		agent: task.agent,
		agentSource: "unknown",
		task: task.task,
		exitCode: -1,
		messages: [],
		stderr: "",
		usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0, contextTokens: 0, turns: 0 },
		maxTurns: limits.maxTurns,
		maxToolCalls: limits.maxToolCalls,
		maxDurationSeconds: limits.maxDurationSeconds,
		toolCallsUsed: 0,
		durationMs: 0,
	};
}

function formatRequestedLimits(agent: string, task: Partial<RequestedTask>): string {
	try {
		const limits = resolveAgentLimits(agent, task);
		return `${limits.maxTurns}t/${limits.maxToolCalls}c/${limits.maxDurationSeconds}s`;
	} catch {
		return "invalid budget";
	}
}

export default function (pi: ExtensionAPI) {
	if (process.env[WORKER_BYPASS_ENV] === "1" || process.env[SESSION_BYPASS_ENV] === "1") return;

	pi.on("session_start", async () => {
		pi.setActiveTools(["subagent"]);
	});

	pi.on("before_agent_start", async (event) => ({
		systemPrompt: `${event.systemPrompt}\n\n${buildDelegationInstructions()}`,
	}));

	pi.registerTool({
		name: "subagent",
		label: "Subagent",
		description: [
			"Delegate tasks to specialized subagents with isolated context.",
			"Modes: single (agent + task), parallel (tasks array), chain (sequential with {previous} placeholder).",
			'Default agent scope is "user" (from ~/.pi/agent/agents).',
			'To enable project-local agents in .pi/agents, set agentScope: "both" (or "project").',
			"Each subagent run is budgeted by turns, tool calls, and time.",
		].join(" "),
		promptSnippet: "Delegate repo work, verification, and code changes to isolated agents. Use scout for quick recon, verifier for proof, and researcher for deep analysis.",
		promptGuidelines: [
			"Use this tool for any real work instead of claiming you ran commands or inspected files yourself.",
			"Scout is for cheap, quick reconnaissance only. Use researcher for in-depth analysis or external docs.",
			"Researcher is repo-first: use web-search/scrape only when local evidence is insufficient or current/external docs are required.",
			"Use verifier for tests, repro checks, build/typecheck/lint runs, and acceptance validation.",
			"When delegating to verifier, include the original spec or acceptance criteria and ask for proof.",
			"Do not use web tools for simple repo-only questions.",
			"For simple repo summaries, start with one scout pass and synthesize before launching more agents.",
			"Do not send overlapping scout tasks in parallel.",
			"Prefer self-contained delegated tasks over tiny one-command requests.",
			"Use parallel tasks only when scopes are clearly independent.",
		],
		parameters: SubagentParams,

		async execute(_toolCallId, params, signal, onUpdate, ctx) {
			const agentScope: AgentScope = params.agentScope ?? "user";
			const discovery = discoverAgents(ctx.cwd, agentScope);
			const agents = discovery.agents;
			const confirmProjectAgents = params.confirmProjectAgents ?? true;

			const hasChain = (params.chain?.length ?? 0) > 0;
			const hasTasks = (params.tasks?.length ?? 0) > 0;
			const hasSingle = Boolean(params.agent && params.task);
			const modeCount = Number(hasChain) + Number(hasTasks) + Number(hasSingle);

			const makeDetails =
				(mode: "single" | "parallel" | "chain") =>
				(results: SingleResult[]): SubagentDetails => ({
					mode,
					agentScope,
					projectAgentsDir: discovery.projectAgentsDir,
					results,
				});
			const runtimeOptions: RuntimeOptions = {
				modelArg: getCurrentModelArg(ctx),
				thinkingLevel: pi.getThinkingLevel(),
			};

			if (modeCount !== 1) {
				const available = agents.map((a) => `${a.name} (${a.source})`).join(", ") || "none";
				return {
					content: [
						{
							type: "text",
							text: `Invalid parameters. Provide exactly one mode.\nAvailable agents: ${available}`,
						},
					],
					details: makeDetails("single")([]),
				};
			}

			const requestedMode: "single" | "parallel" | "chain" = hasChain ? "chain" : hasTasks ? "parallel" : "single";
			const requestedTasks: RequestedTask[] = hasChain
				? params.chain!
				: hasTasks
					? params.tasks!
					: [
							{
								agent: params.agent!,
								task: params.task!,
								cwd: params.cwd,
								maxTurns: params.maxTurns,
								maxToolCalls: params.maxToolCalls,
								maxDurationSeconds: params.maxDurationSeconds,
							},
						];
			const validationError = validateRequestedTasks(requestedMode, requestedTasks);
			if (validationError) {
				return {
					content: [{ type: "text", text: validationError }],
					details: makeDetails(requestedMode)([]),
					isError: true,
				};
			}

			if ((agentScope === "project" || agentScope === "both") && confirmProjectAgents && ctx.hasUI) {
				const requestedAgentNames = new Set<string>();
				if (params.chain) for (const step of params.chain) requestedAgentNames.add(step.agent);
				if (params.tasks) for (const t of params.tasks) requestedAgentNames.add(t.agent);
				if (params.agent) requestedAgentNames.add(params.agent);

				const projectAgentsRequested = Array.from(requestedAgentNames)
					.map((name) => agents.find((a) => a.name === name))
					.filter((a): a is AgentConfig => a?.source === "project");

				if (projectAgentsRequested.length > 0) {
					const names = projectAgentsRequested.map((a) => a.name).join(", ");
					const dir = discovery.projectAgentsDir ?? "(unknown)";
					const ok = await ctx.ui.confirm(
						"Run project-local agents?",
						`Agents: ${names}\nSource: ${dir}\n\nProject agents are repo-controlled. Only continue for trusted repositories.`,
					);
					if (!ok)
						return {
							content: [{ type: "text", text: "Canceled: project-local agents not approved." }],
							details: makeDetails(hasChain ? "chain" : hasTasks ? "parallel" : "single")([]),
						};
				}
			}

			if (params.chain && params.chain.length > 0) {
				const results: SingleResult[] = [];
				let previousOutput = "";

				for (let i = 0; i < params.chain.length; i++) {
					const step = params.chain[i];
					const taskWithContext = step.task.replace(/\{previous\}/g, previousOutput);

					// Create update callback that includes all previous results
					const chainUpdate: OnUpdateCallback | undefined = onUpdate
						? (partial) => {
								// Combine completed results with current streaming result
								const currentResult = partial.details?.results[0];
								if (currentResult) {
									const allResults = [...results, currentResult];
									onUpdate({
										content: partial.content,
										details: makeDetails("chain")(allResults),
									});
								}
							}
						: undefined;

					const result = await runSingleAgent(
						ctx.cwd,
						agents,
						step.agent,
						taskWithContext,
						step.cwd,
						i + 1,
						{
							maxTurns: step.maxTurns,
							maxToolCalls: step.maxToolCalls,
							maxDurationSeconds: step.maxDurationSeconds,
						},
						signal,
						chainUpdate,
						makeDetails("chain"),
						runtimeOptions,
					);
					results.push(result);

					const isError =
						result.exitCode !== 0 || result.stopReason === "error" || result.stopReason === "aborted";
					if (isError) {
						const errorMsg =
							result.errorMessage || result.stderr || getFinalOutput(result.messages) || "(no output)";
						return {
							content: [{ type: "text", text: `Chain stopped at step ${i + 1} (${step.agent}): ${errorMsg}` }],
							details: makeDetails("chain")(results),
							isError: true,
						};
					}
					previousOutput = getFinalOutput(result.messages);
				}
				return {
					content: [{ type: "text", text: getFinalOutput(results[results.length - 1].messages) || "(no output)" }],
					details: makeDetails("chain")(results),
				};
			}

			if (params.tasks && params.tasks.length > 0) {
				if (params.tasks.length > MAX_PARALLEL_TASKS)
					return {
						content: [
							{
								type: "text",
								text: `Too many parallel tasks (${params.tasks.length}). Max is ${MAX_PARALLEL_TASKS}.`,
							},
						],
						details: makeDetails("parallel")([]),
					};

				// Track all results for streaming updates
				const allResults: SingleResult[] = new Array(params.tasks.length);

				// Initialize placeholder results
				for (let i = 0; i < params.tasks.length; i++) {
					allResults[i] = createPlaceholderResult(params.tasks[i]);
				}

				const emitParallelUpdate = () => {
					if (onUpdate) {
						const running = allResults.filter((r) => r.exitCode === -1).length;
						const done = allResults.filter((r) => r.exitCode !== -1).length;
						onUpdate({
							content: [
								{ type: "text", text: `Parallel: ${done}/${allResults.length} done, ${running} running...` },
							],
							details: makeDetails("parallel")([...allResults]),
						});
					}
				};

				const results = await mapWithConcurrencyLimit(params.tasks, MAX_CONCURRENCY, async (t, index) => {
					const result = await runSingleAgent(
						ctx.cwd,
						agents,
						t.agent,
						t.task,
						t.cwd,
						undefined,
						{
							maxTurns: t.maxTurns,
							maxToolCalls: t.maxToolCalls,
							maxDurationSeconds: t.maxDurationSeconds,
						},
						signal,
						// Per-task update callback
						(partial) => {
							if (partial.details?.results[0]) {
								allResults[index] = partial.details.results[0];
								emitParallelUpdate();
							}
						},
						makeDetails("parallel"),
						runtimeOptions,
					);
					allResults[index] = result;
					emitParallelUpdate();
					return result;
				});

				const successCount = results.filter((r) => r.exitCode === 0).length;
				const summaries = results.map((r) => {
					const output = getFinalOutput(r.messages);
					const preview = output.slice(0, 100) + (output.length > 100 ? "..." : "");
					return `[${r.agent}] ${r.exitCode === 0 ? "completed" : "failed"}: ${preview || "(no output)"}`;
				});
				return {
					content: [
						{
							type: "text",
							text: `Parallel: ${successCount}/${results.length} succeeded\n\n${summaries.join("\n\n")}`,
						},
					],
					details: makeDetails("parallel")(results),
				};
			}

			if (params.agent && params.task) {
				const result = await runSingleAgent(
					ctx.cwd,
					agents,
					params.agent,
					params.task,
					params.cwd,
					undefined,
					{
						maxTurns: params.maxTurns,
						maxToolCalls: params.maxToolCalls,
						maxDurationSeconds: params.maxDurationSeconds,
					},
					signal,
					onUpdate,
					makeDetails("single"),
					runtimeOptions,
				);
				const isError = result.exitCode !== 0 || result.stopReason === "error" || result.stopReason === "aborted";
				if (isError) {
					const errorMsg =
						result.errorMessage || result.stderr || getFinalOutput(result.messages) || "(no output)";
					return {
						content: [{ type: "text", text: `Agent ${result.stopReason || "failed"}: ${errorMsg}` }],
						details: makeDetails("single")([result]),
						isError: true,
					};
				}
				return {
					content: [{ type: "text", text: getFinalOutput(result.messages) || "(no output)" }],
					details: makeDetails("single")([result]),
				};
			}

			const available = agents.map((a) => `${a.name} (${a.source})`).join(", ") || "none";
			return {
				content: [{ type: "text", text: `Invalid parameters. Available agents: ${available}` }],
				details: makeDetails("single")([]),
			};
		},

		renderCall(args, theme, _context) {
			const scope: AgentScope = args.agentScope ?? "user";
			if (args.chain && args.chain.length > 0) {
				let text =
					theme.fg("toolTitle", theme.bold("subagent ")) +
					theme.fg("accent", `chain (${args.chain.length} steps)`) +
					theme.fg("muted", ` [${scope}]`);
				for (let i = 0; i < Math.min(args.chain.length, 3); i++) {
					const step = args.chain[i];
					// Clean up {previous} placeholder for display
					const cleanTask = step.task.replace(/\{previous\}/g, "").trim();
					const preview = cleanTask.length > 40 ? `${cleanTask.slice(0, 40)}...` : cleanTask;
					const limits = formatRequestedLimits(step.agent, step);
					text +=
						"\n  " +
						theme.fg("muted", `${i + 1}.`) +
						" " +
						theme.fg("accent", step.agent) +
						theme.fg("dim", ` ${preview} [${limits}]`);
				}
				if (args.chain.length > 3) text += `\n  ${theme.fg("muted", `... +${args.chain.length - 3} more`)}`;
				return new Text(text, 0, 0);
			}
			if (args.tasks && args.tasks.length > 0) {
				let text =
					theme.fg("toolTitle", theme.bold("subagent ")) +
					theme.fg("accent", `parallel (${args.tasks.length} tasks)`) +
					theme.fg("muted", ` [${scope}]`);
				for (const t of args.tasks.slice(0, 3)) {
					const preview = t.task.length > 40 ? `${t.task.slice(0, 40)}...` : t.task;
					const limits = formatRequestedLimits(t.agent, t);
					text += `\n  ${theme.fg("accent", t.agent)}${theme.fg("dim", ` ${preview} [${limits}]`)}`;
				}
				if (args.tasks.length > 3) text += `\n  ${theme.fg("muted", `... +${args.tasks.length - 3} more`)}`;
				return new Text(text, 0, 0);
			}
			const agentName = args.agent || "...";
			const preview = args.task ? (args.task.length > 60 ? `${args.task.slice(0, 60)}...` : args.task) : "...";
			const limits = formatRequestedLimits(agentName, args);
			let text =
				theme.fg("toolTitle", theme.bold("subagent ")) +
				theme.fg("accent", agentName) +
				theme.fg("muted", ` [${scope}]`);
			text += `\n  ${theme.fg("dim", `${preview} [${limits}]`)}`;
			return new Text(text, 0, 0);
		},

		renderResult(result, { expanded }, theme, _context) {
			const details = result.details as SubagentDetails | undefined;
			if (!details || details.results.length === 0) {
				const text = result.content[0];
				return new Text(text?.type === "text" ? text.text : "(no output)", 0, 0);
			}

			const mdTheme = getMarkdownTheme();

			const renderDisplayItems = (items: DisplayItem[], limit?: number) => {
				const toShow = limit ? items.slice(-limit) : items;
				const skipped = limit && items.length > limit ? items.length - limit : 0;
				let text = "";
				if (skipped > 0) text += theme.fg("muted", `... ${skipped} earlier items\n`);
				for (const item of toShow) {
					if (item.type === "text") {
						const preview = expanded ? item.text : item.text.split("\n").slice(0, 3).join("\n");
						text += `${theme.fg("toolOutput", preview)}\n`;
					} else {
						text += `${theme.fg("muted", "→ ") + formatToolCall(item.name, item.args, theme.fg.bind(theme))}\n`;
					}
				}
				return text.trimEnd();
			};

			if (details.mode === "single" && details.results.length === 1) {
				const r = details.results[0];
				const isError = r.exitCode !== 0 || r.stopReason === "error" || r.stopReason === "aborted";
				const icon = isError ? theme.fg("error", "✗") : theme.fg("success", "✓");
				const displayItems = getDisplayItems(r.messages);
				const finalOutput = getFinalOutput(r.messages);

				if (expanded) {
					const container = new Container();
					let header = `${icon} ${theme.fg("toolTitle", theme.bold(r.agent))}${theme.fg("muted", ` (${r.agentSource})`)}`;
					if (isError && r.stopReason) header += ` ${theme.fg("error", `[${r.stopReason}]`)}`;
					container.addChild(new Text(header, 0, 0));
					if (isError && r.errorMessage)
						container.addChild(new Text(theme.fg("error", `Error: ${r.errorMessage}`), 0, 0));
					container.addChild(new Spacer(1));
					container.addChild(new Text(theme.fg("muted", "─── Task ───"), 0, 0));
					container.addChild(new Text(theme.fg("dim", r.task), 0, 0));
					container.addChild(new Spacer(1));
					container.addChild(new Text(theme.fg("muted", "─── Output ───"), 0, 0));
					if (displayItems.length === 0 && !finalOutput) {
						container.addChild(new Text(theme.fg("muted", "(no output)"), 0, 0));
					} else {
						for (const item of displayItems) {
							if (item.type === "toolCall")
								container.addChild(
									new Text(
										theme.fg("muted", "→ ") + formatToolCall(item.name, item.args, theme.fg.bind(theme)),
										0,
										0,
									),
								);
						}
						if (finalOutput) {
							container.addChild(new Spacer(1));
							container.addChild(new Markdown(finalOutput.trim(), 0, 0, mdTheme));
						}
					}
					const usageStr = formatUsageStats(r.usage, r.model);
					const limitStr = formatLimitStats({
						turnsUsed: r.usage.turns,
						maxTurns: r.maxTurns,
						toolCallsUsed: r.toolCallsUsed,
						maxToolCalls: r.maxToolCalls,
						durationMs: r.durationMs,
						maxDurationSeconds: r.maxDurationSeconds,
					});
					if (usageStr || limitStr) {
						container.addChild(new Spacer(1));
						if (usageStr) container.addChild(new Text(theme.fg("dim", usageStr), 0, 0));
						if (limitStr) container.addChild(new Text(theme.fg("dim", limitStr), 0, 0));
					}
					return container;
				}

				let text = `${icon} ${theme.fg("toolTitle", theme.bold(r.agent))}${theme.fg("muted", ` (${r.agentSource})`)}`;
				if (isError && r.stopReason) text += ` ${theme.fg("error", `[${r.stopReason}]`)}`;
				if (isError && r.errorMessage) text += `\n${theme.fg("error", `Error: ${r.errorMessage}`)}`;
				else if (displayItems.length === 0) text += `\n${theme.fg("muted", "(no output)")}`;
				else {
					text += `\n${renderDisplayItems(displayItems, COLLAPSED_ITEM_COUNT)}`;
					if (displayItems.length > COLLAPSED_ITEM_COUNT) text += `\n${theme.fg("muted", "(Ctrl+O to expand)")}`;
				}
				const usageStr = formatUsageStats(r.usage, r.model);
				const limitStr = formatLimitStats({
					turnsUsed: r.usage.turns,
					maxTurns: r.maxTurns,
					toolCallsUsed: r.toolCallsUsed,
					maxToolCalls: r.maxToolCalls,
					durationMs: r.durationMs,
					maxDurationSeconds: r.maxDurationSeconds,
				});
				if (usageStr) text += `\n${theme.fg("dim", usageStr)}`;
				if (limitStr) text += `\n${theme.fg("dim", limitStr)}`;
				return new Text(text, 0, 0);
			}

			const aggregateUsage = (results: SingleResult[]) => {
				const total = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0, turns: 0 };
				for (const r of results) {
					total.input += r.usage.input;
					total.output += r.usage.output;
					total.cacheRead += r.usage.cacheRead;
					total.cacheWrite += r.usage.cacheWrite;
					total.cost += r.usage.cost;
					total.turns += r.usage.turns;
				}
				return total;
			};

			const aggregateLimits = (results: SingleResult[]) => {
				const total = { turnsUsed: 0, maxTurns: 0, toolCallsUsed: 0, maxToolCalls: 0, durationMs: 0, maxDurationSeconds: 0 };
				for (const r of results) {
					total.turnsUsed += r.usage.turns;
					total.maxTurns += r.maxTurns;
					total.toolCallsUsed += r.toolCallsUsed;
					total.maxToolCalls += r.maxToolCalls;
					total.durationMs += r.durationMs;
					total.maxDurationSeconds += r.maxDurationSeconds;
				}
				return total;
			};

			if (details.mode === "chain") {
				const successCount = details.results.filter((r) => r.exitCode === 0).length;
				const icon = successCount === details.results.length ? theme.fg("success", "✓") : theme.fg("error", "✗");

				if (expanded) {
					const container = new Container();
					container.addChild(
						new Text(
							icon +
								" " +
								theme.fg("toolTitle", theme.bold("chain ")) +
								theme.fg("accent", `${successCount}/${details.results.length} steps`),
							0,
							0,
						),
					);

					for (const r of details.results) {
						const rIcon = r.exitCode === 0 ? theme.fg("success", "✓") : theme.fg("error", "✗");
						const displayItems = getDisplayItems(r.messages);
						const finalOutput = getFinalOutput(r.messages);

						container.addChild(new Spacer(1));
						container.addChild(
							new Text(
								`${theme.fg("muted", `─── Step ${r.step}: `) + theme.fg("accent", r.agent)} ${rIcon}`,
								0,
								0,
							),
						);
						container.addChild(new Text(theme.fg("muted", "Task: ") + theme.fg("dim", r.task), 0, 0));

						// Show tool calls
						for (const item of displayItems) {
							if (item.type === "toolCall") {
								container.addChild(
									new Text(
										theme.fg("muted", "→ ") + formatToolCall(item.name, item.args, theme.fg.bind(theme)),
										0,
										0,
									),
								);
							}
						}

						// Show final output as markdown
						if (finalOutput) {
							container.addChild(new Spacer(1));
							container.addChild(new Markdown(finalOutput.trim(), 0, 0, mdTheme));
						}

						const stepUsage = formatUsageStats(r.usage, r.model);
						const stepLimits = formatLimitStats({
							turnsUsed: r.usage.turns,
							maxTurns: r.maxTurns,
							toolCallsUsed: r.toolCallsUsed,
							maxToolCalls: r.maxToolCalls,
							durationMs: r.durationMs,
							maxDurationSeconds: r.maxDurationSeconds,
						});
						if (stepUsage) container.addChild(new Text(theme.fg("dim", stepUsage), 0, 0));
						if (stepLimits) container.addChild(new Text(theme.fg("dim", stepLimits), 0, 0));
					}

					const usageStr = formatUsageStats(aggregateUsage(details.results));
					const limitStr = formatLimitStats(aggregateLimits(details.results));
					if (usageStr || limitStr) {
						container.addChild(new Spacer(1));
						if (usageStr) container.addChild(new Text(theme.fg("dim", `Total: ${usageStr}`), 0, 0));
						if (limitStr) container.addChild(new Text(theme.fg("dim", `Total: ${limitStr}`), 0, 0));
					}
					return container;
				}

				// Collapsed view
				let text =
					icon +
					" " +
					theme.fg("toolTitle", theme.bold("chain ")) +
					theme.fg("accent", `${successCount}/${details.results.length} steps`);
				for (const r of details.results) {
					const rIcon = r.exitCode === 0 ? theme.fg("success", "✓") : theme.fg("error", "✗");
					const displayItems = getDisplayItems(r.messages);
					text += `\n\n${theme.fg("muted", `─── Step ${r.step}: `)}${theme.fg("accent", r.agent)} ${rIcon}`;
					if (displayItems.length === 0) text += `\n${theme.fg("muted", "(no output)")}`;
					else text += `\n${renderDisplayItems(displayItems, 5)}`;
				}
				const usageStr = formatUsageStats(aggregateUsage(details.results));
				const limitStr = formatLimitStats(aggregateLimits(details.results));
				if (usageStr) text += `\n\n${theme.fg("dim", `Total: ${usageStr}`)}`;
				if (limitStr) text += `\n${theme.fg("dim", `Total: ${limitStr}`)}`;
				text += `\n${theme.fg("muted", "(Ctrl+O to expand)")}`;
				return new Text(text, 0, 0);
			}

			if (details.mode === "parallel") {
				const running = details.results.filter((r) => r.exitCode === -1).length;
				const successCount = details.results.filter((r) => r.exitCode === 0).length;
				const failCount = details.results.filter((r) => r.exitCode > 0).length;
				const isRunning = running > 0;
				const icon = isRunning
					? theme.fg("warning", "⏳")
					: failCount > 0
						? theme.fg("warning", "◐")
						: theme.fg("success", "✓");
				const status = isRunning
					? `${successCount + failCount}/${details.results.length} done, ${running} running`
					: `${successCount}/${details.results.length} tasks`;

				if (expanded && !isRunning) {
					const container = new Container();
					container.addChild(
						new Text(
							`${icon} ${theme.fg("toolTitle", theme.bold("parallel "))}${theme.fg("accent", status)}`,
							0,
							0,
						),
					);

					for (const r of details.results) {
						const rIcon = r.exitCode === 0 ? theme.fg("success", "✓") : theme.fg("error", "✗");
						const displayItems = getDisplayItems(r.messages);
						const finalOutput = getFinalOutput(r.messages);

						container.addChild(new Spacer(1));
						container.addChild(
							new Text(`${theme.fg("muted", "─── ") + theme.fg("accent", r.agent)} ${rIcon}`, 0, 0),
						);
						container.addChild(new Text(theme.fg("muted", "Task: ") + theme.fg("dim", r.task), 0, 0));

						// Show tool calls
						for (const item of displayItems) {
							if (item.type === "toolCall") {
								container.addChild(
									new Text(
										theme.fg("muted", "→ ") + formatToolCall(item.name, item.args, theme.fg.bind(theme)),
										0,
										0,
									),
								);
							}
						}

						// Show final output as markdown
						if (finalOutput) {
							container.addChild(new Spacer(1));
							container.addChild(new Markdown(finalOutput.trim(), 0, 0, mdTheme));
						}

						const taskUsage = formatUsageStats(r.usage, r.model);
						const taskLimits = formatLimitStats({
							turnsUsed: r.usage.turns,
							maxTurns: r.maxTurns,
							toolCallsUsed: r.toolCallsUsed,
							maxToolCalls: r.maxToolCalls,
							durationMs: r.durationMs,
							maxDurationSeconds: r.maxDurationSeconds,
						});
						if (taskUsage) container.addChild(new Text(theme.fg("dim", taskUsage), 0, 0));
						if (taskLimits) container.addChild(new Text(theme.fg("dim", taskLimits), 0, 0));
					}

					const usageStr = formatUsageStats(aggregateUsage(details.results));
					const limitStr = formatLimitStats(aggregateLimits(details.results));
					if (usageStr || limitStr) {
						container.addChild(new Spacer(1));
						if (usageStr) container.addChild(new Text(theme.fg("dim", `Total: ${usageStr}`), 0, 0));
						if (limitStr) container.addChild(new Text(theme.fg("dim", `Total: ${limitStr}`), 0, 0));
					}
					return container;
				}

				// Collapsed view (or still running)
				let text = `${icon} ${theme.fg("toolTitle", theme.bold("parallel "))}${theme.fg("accent", status)}`;
				for (const r of details.results) {
					const rIcon =
						r.exitCode === -1
							? theme.fg("warning", "⏳")
							: r.exitCode === 0
								? theme.fg("success", "✓")
								: theme.fg("error", "✗");
					const displayItems = getDisplayItems(r.messages);
					text += `\n\n${theme.fg("muted", "─── ")}${theme.fg("accent", r.agent)} ${rIcon}`;
					if (displayItems.length === 0)
						text += `\n${theme.fg("muted", r.exitCode === -1 ? "(running...)" : "(no output)")}`;
					else text += `\n${renderDisplayItems(displayItems, 5)}`;
				}
				if (!isRunning) {
					const usageStr = formatUsageStats(aggregateUsage(details.results));
					const limitStr = formatLimitStats(aggregateLimits(details.results));
					if (usageStr) text += `\n\n${theme.fg("dim", `Total: ${usageStr}`)}`;
					if (limitStr) text += `\n${theme.fg("dim", `Total: ${limitStr}`)}`;
				}
				if (!expanded) text += `\n${theme.fg("muted", "(Ctrl+O to expand)")}`;
				return new Text(text, 0, 0);
			}

			const text = result.content[0];
			return new Text(text?.type === "text" ? text.text : "(no output)", 0, 0);
		},
	});
}
