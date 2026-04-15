import { spawn } from "node:child_process";
import { promises as fsp } from "node:fs";
import os from "node:os";
import path from "node:path";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Text } from "@mariozechner/pi-tui";
import { Type } from "@sinclair/typebox";

const WORKER_BYPASS_ENV = "PI_SUBAGENT_WORKER";
const SESSION_BYPASS_ENV = "PI_SUBAGENT_DISABLE";
const STATUS_ID = "delegated-subagents";
const AGENTS_DIR = path.join(process.env.PI_CODING_AGENT_DIR?.trim() || path.join(os.homedir(), ".pi", "agent"), "agents");

const WORKER_TOOLS = ["read", "bash", "edit", "write", "grep", "find", "ls"];
const MAX_PARALLEL = 4;
const HARD_MAX_PARALLEL = 8;
const WORKER_TIMEOUT_MS = 15 * 60 * 1000;

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
	label: string;
	worker: string;
	task: string;
	cwd: string;
	exitCode: number;
	output: string;
	error?: string;
	durationMs: number;
};

type ToolDetails = {
	mode: "single" | "parallel";
	results: WorkerResult[];
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

function extractAssistantText(message: any): string {
	if (!message || !Array.isArray(message.content)) return "";
	return message.content
		.filter((part: any) => part?.type === "text" && typeof part.text === "string")
		.map((part: any) => part.text)
		.join("\n")
		.trim();
}

function preview(text: string, max = 120): string {
	const singleLine = text.replace(/\s+/g, " ").trim();
	if (!singleLine) return "(no output)";
	return singleLine.length > max ? `${singleLine.slice(0, max)}...` : singleLine;
}

function formatDuration(durationMs: number): string {
	const totalSeconds = Math.max(1, Math.round(durationMs / 1000));
	if (totalSeconds < 60) return `${totalSeconds}s`;
	const minutes = Math.floor(totalSeconds / 60);
	const seconds = totalSeconds % 60;
	return seconds === 0 ? `${minutes}m` : `${minutes}m${seconds}s`;
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

function setOrchestratorStatus(ctx: any, results: WorkerResult[] = []) {
	if (!ctx.hasUI) return;
	ctx.ui.setStatus(STATUS_ID, formatStatusSummary(results));
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
	task: WorkerTask,
	worker: WorkerSpec,
	index: number,
	defaultCwd: string,
	defaultModel: string | undefined,
	defaultThinking: string | undefined,
	signal: AbortSignal | undefined,
): Promise<WorkerResult> {
	const label = task.label?.trim() || `worker-${index + 1}`;
	const cwd = task.cwd || defaultCwd;
	const result: WorkerResult = {
		label,
		worker: worker.name,
		task: task.task,
		cwd,
		exitCode: -1,
		output: "",
		error: undefined,
		durationMs: 0,
	};

	const promptFile = await writeTempPrompt(buildWorkerPrompt(worker, cwd));
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
	args.push(task.task);

	const startedAt = Date.now();
	const emit = () => {
		result.durationMs = Date.now() - startedAt;
	};

	try {
		await new Promise<void>((resolve, reject) => {
			const proc = spawn(invocation.command, args, {
				cwd,
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
				emit();
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
				if (event.type !== "message_end" || event.message?.role !== "assistant") return;
				const text = extractAssistantText(event.message);
				if (text) result.output = text;
				if (event.message?.errorMessage) result.error = event.message.errorMessage;
				emit();
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
				if (!result.error) result.error = error.message;
				finish(error);
			});

			proc.on("close", (code, closeSignal) => {
				if (buffer.trim()) processLine(buffer);
				result.durationMs = Date.now() - startedAt;
				result.exitCode = code ?? 0;
				if (closeSignal && !result.error) result.error = `Worker exited via signal ${closeSignal}`;
				if (result.exitCode !== 0 && !result.error) result.error = stderr.trim() || `Worker exited with code ${result.exitCode}`;
				emit();
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
		lines.push(`- ${result.label}: ${preview(result.error || result.output)}`);
	}
	return lines.join("\n");
}

export default function delegatedSubagents(pi: ExtensionAPI) {
	if (process.env[WORKER_BYPASS_ENV] === "1" || process.env[SESSION_BYPASS_ENV] === "1") return;

	pi.on("session_start", async (_event, ctx) => {
		pi.setActiveTools(["subagent"]);
		setOrchestratorStatus(ctx);
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
			const roster = await loadWorkerRoster();
			if (roster.length === 0) {
				if (ctx.hasUI) ctx.ui.notify(`No workers found in ${AGENTS_DIR}`, "warning");
				return;
			}
			const lines = roster.map((worker) => `${worker.name} - ${worker.description}`);
			if (ctx.hasUI) ctx.ui.notify(lines.join("\n"), "info");
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

		async execute(_toolCallId, params, signal, _onUpdate, ctx) {
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
				const runningResult: WorkerResult = {
					label: task.label?.trim() || "worker-1",
					worker: worker.name,
					task: task.task,
					cwd: task.cwd || ctx.cwd,
					exitCode: -1,
					output: "",
					error: undefined,
					durationMs: 0,
				};
				setOrchestratorStatus(ctx, [runningResult]);
				try {
					const result = await runWorker(task, worker, 0, ctx.cwd, model, thinking, signal);
					setOrchestratorStatus(ctx, [result]);
					return {
						content: [{ type: "text", text: result.error ? `Worker failed: ${result.error}` : result.output || "(no output)" }],
						details: { mode: "single", results: [result] } satisfies ToolDetails,
						isError: result.exitCode !== 0,
					};
				} catch (error: any) {
					setOrchestratorStatus(ctx);
					throw error;
				}
			}

			if (params.tasks.length > HARD_MAX_PARALLEL) {
				return {
					content: [{ type: "text", text: `Too many parallel workers. Max is ${HARD_MAX_PARALLEL}.` }],
					details: { mode: "parallel", results: [] } satisfies ToolDetails,
					isError: true,
				};
			}

			const resolvedTasks: Array<{ task: WorkerTask; worker: WorkerSpec }> = [];
			for (const item of params.tasks as WorkerTask[]) {
				const workerName = item.worker?.trim() || "worker";
				const worker = getWorkerSpec(roster, workerName);
				if (!worker) {
					return {
						content: [{ type: "text", text: `Unknown worker: ${workerName}. Available workers: ${listWorkerNames(roster)}.` }],
						details: { mode: "parallel", results: [] } satisfies ToolDetails,
						isError: true,
					};
				}
				resolvedTasks.push({
					task: {
						label: item.label,
						worker: worker.name,
						task: item.task,
						cwd: item.cwd,
					},
					worker,
				});
			}

			const pendingResults: WorkerResult[] = resolvedTasks.map(({ task, worker }, index: number) => ({
				label: task.label?.trim() || `worker-${index + 1}`,
				worker: worker.name,
				task: task.task,
				cwd: task.cwd || ctx.cwd,
				exitCode: -1,
				output: "",
				error: undefined,
				durationMs: 0,
			}));
			setOrchestratorStatus(ctx, pendingResults);

			try {
				const results = await mapWithConcurrencyLimit(
					resolvedTasks,
					Math.min(MAX_PARALLEL, resolvedTasks.length),
					(item, index: number) => runWorker(item.task, item.worker, index, ctx.cwd, model, thinking, signal),
				);
				setOrchestratorStatus(ctx, results);

				const allSucceeded = results.every((result) => result.exitCode === 0);
				return {
					content: [{ type: "text", text: summarizeParallel(results) }],
					details: { mode: "parallel", results } satisfies ToolDetails,
					isError: !allSucceeded,
				};
			} catch (error: any) {
				setOrchestratorStatus(ctx);
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
				return new Text(
					[
						`${theme.fg("toolTitle", theme.bold("WORKER"))}${theme.fg("border", " ─ ")}${theme.fg("accent", worker.label)}`,
						renderWorkerSummary(theme, worker),
						theme.fg(worker.exitCode === 0 ? "text" : "error", preview(worker.error || worker.output, 220)),
					].join("\n"),
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
				lines.push(theme.fg("dim", preview(worker.error || worker.output, 160)));
			}
			return new Text(lines.join("\n"), 0, 0);
		},
	});
}
