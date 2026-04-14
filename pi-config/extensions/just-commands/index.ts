import type {
	AgentMessage,
	ExtensionAPI,
	ExtensionCommandContext,
	ExtensionContext,
} from "@mariozechner/pi-coding-agent";
import {
	DEFAULT_MAX_BYTES,
	DEFAULT_MAX_LINES,
	formatSize,
	truncateTail,
} from "@mariozechner/pi-coding-agent";
import { Box, Text } from "@mariozechner/pi-tui";
import { createHash, randomUUID } from "node:crypto";
import { readFileSync, watch, type FSWatcher } from "node:fs";
import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";
import { homedir, tmpdir } from "node:os";

const MESSAGE_TYPE = "just-command-output";
const STATUS_ID = "just-commands";
const CANDIDATE_JUSTFILES = ["justfile", ".justfile", "Justfile"] as const;
const COMMAND_PREFIX = "just-";
const AUTO_REFRESH = true;
const WATCH_DEBOUNCE_MS = 500;
const CONFIG_PATH = join(homedir(), ".pi", "agent", "extensions", "just-commands", "config.json");

const BUILTIN_RESERVED = new Set([
	"model",
	"settings",
	"new",
	"resume",
	"fork",
	"compact",
	"tree",
	"reload",
	"login",
	"help",
	"exit",
	"quit",
]);

const UTILITY_COMMANDS = new Set([
	"just-recipes",
	"just-refresh",
	"just-watch",
	"just-which",
	"just-hide",
	"just-unhide",
]);

type CommandContext = ExtensionContext | ExtensionCommandContext;

type MessageDetails =
	| {
			kind: "run";
			status: "success" | "error";
			commandName: string;
			recipeName: string;
			argsDisplay: string;
			elapsedMs: number;
			exitCode: number | null;
			cwd?: string;
			justfile?: string;
			output?: string;
			truncated?: boolean;
			truncatedLines?: number;
			totalLines?: number;
			truncatedBytes?: number;
			totalBytes?: number;
			fullOutputPath?: string;
		}
	| {
			kind: "recipes" | "watch" | "info";
			status: "info" | "warning" | "error" | "success";
			lines: string[];
		};

interface JustParameter {
	default: string | null;
	export: boolean;
	help: string | null;
	kind: "singular" | "star" | "plus" | string;
	long: string | null;
	name: string;
	pattern: string | null;
	short: string | null;
	value: string | null;
}

interface JustRecipe {
	name: string;
	namepath: string;
	doc: string | null;
	private: boolean;
	parameters?: JustParameter[];
}

interface JustDump {
	source?: string;
	modules?: Record<string, unknown>;
	recipes?: Record<string, JustRecipe>;
}

interface RecipeCommand {
	invokeName: string;
	displayName: string;
	commandName: string;
	description: string;
	usage: string;
	parameters: JustParameter[];
	origin: "native-name" | "native-namepath" | "prefixed";
}

interface RegistryState {
	cwd: string;
	searchDirs: string[];
	justfilePath?: string;
	workingDirectory?: string;
	watchFiles: string[];
	recipes: RecipeCommand[];
	commandMap: Map<string, RecipeCommand>;
	hash: string;
	scanError?: string;
	discoveredAt: number;
}

interface RuntimeState {
	cwd: string;
	registry: RegistryState;
	watchers: FSWatcher[];
	watchedDirBasenames: Map<string, Set<string>>;
	rescanTimer: ReturnType<typeof setTimeout> | undefined;
	refreshQueued: boolean;
	lastRefreshReason: string | undefined;
	hideRecipeCommands: boolean;
}

interface JustCommandsConfig {
	hideRecipeCommands: boolean;
}

const EMPTY_REGISTRY = (cwd: string): RegistryState => ({
	cwd,
	searchDirs: [],
	watchFiles: [],
	recipes: [],
	commandMap: new Map(),
	hash: "no-justfile",
	discoveredAt: Date.now(),
});

export default function justCommandsExtension(pi: ExtensionAPI) {
	function loadConfigSync(): JustCommandsConfig {
		try {
			const raw = readFileSync(CONFIG_PATH, "utf8");
			const parsed = JSON.parse(raw) as Partial<JustCommandsConfig>;
			return {
				hideRecipeCommands: parsed.hideRecipeCommands === true,
			};
		} catch {
			return { hideRecipeCommands: false };
		}
	}

	let runtime: RuntimeState = {
		cwd: process.cwd(),
		registry: EMPTY_REGISTRY(process.cwd()),
		watchers: [],
		watchedDirBasenames: new Map(),
		rescanTimer: undefined,
		refreshQueued: false,
		lastRefreshReason: undefined,
		hideRecipeCommands: loadConfigSync().hideRecipeCommands,
	};

	const registeredRecipeCommandNames = new Set<string>();

	async function loadConfig(): Promise<JustCommandsConfig> {
		try {
			const raw = await readFile(CONFIG_PATH, "utf8");
			const parsed = JSON.parse(raw) as Partial<JustCommandsConfig>;
			return {
				hideRecipeCommands: parsed.hideRecipeCommands === true,
			};
		} catch {
			return { hideRecipeCommands: false };
		}
	}

	async function saveConfig(config: JustCommandsConfig): Promise<void> {
		await mkdir(dirname(CONFIG_PATH), { recursive: true });
		await writeFile(CONFIG_PATH, `${JSON.stringify(config, null, 2)}\n`, "utf8");
	}

	function setStatus(ctx: ExtensionContext) {
		if (!runtime.registry.justfilePath) {
			ctx.ui.setStatus(STATUS_ID, undefined);
			return;
		}

		if (runtime.registry.scanError) {
			ctx.ui.setStatus(STATUS_ID, "just error");
			return;
		}

		if (runtime.refreshQueued) {
			ctx.ui.setStatus(STATUS_ID, "just refresh queued");
			return;
		}

		ctx.ui.setStatus(STATUS_ID, undefined);
	}

	function clearWatchers() {
		for (const watcher of runtime.watchers) {
			try {
				watcher.close();
			} catch {
				// ignore
			}
		}
		runtime.watchers = [];
		runtime.watchedDirBasenames.clear();
		if (runtime.rescanTimer) {
			clearTimeout(runtime.rescanTimer);
			runtime.rescanTimer = undefined;
		}
	}

	function formatRelativePath(path?: string): string | undefined {
		if (!path) return undefined;
		const rel = relative(runtime.cwd, path);
		return rel && !rel.startsWith("..") ? rel || "." : path;
	}

	function quoteForDisplay(value: string): string {
		if (value === "") return "''";
		if (/^[A-Za-z0-9_./:-]+$/.test(value)) return value;
		return JSON.stringify(value);
	}

	function formatParameter(parameter: JustParameter): string {
		if (parameter.kind === "plus") return `+${parameter.name}`;
		if (parameter.kind === "star") {
			if (parameter.default !== null) return `*${parameter.name}=${quoteForDisplay(parameter.default)}`;
			return `*${parameter.name}`;
		}
		if (parameter.default !== null) return `${parameter.name}=${quoteForDisplay(parameter.default)}`;
		return parameter.name;
	}

	function buildUsage(recipe: JustRecipe): string {
		const parameters = recipe.parameters ?? [];
		const parameterText = parameters.map(formatParameter).join(" ");
		return parameterText ? `${recipe.namepath} ${parameterText}` : recipe.namepath;
	}

	function buildDescription(recipe: JustRecipe): string {
		const doc = recipe.doc?.trim();
		if (doc) return doc;
		return buildUsage(recipe);
	}

	function safeCommandName(input: string): string {
		const safe = input
			.toLowerCase()
			.replace(/::/g, "-")
			.replace(/[^a-z0-9_-]+/g, "-")
			.replace(/-+/g, "-")
			.replace(/^-+|-+$/g, "");
		return safe || "just";
	}

	function currentReservedNames(): Set<string> {
		const reserved = new Set<string>([...BUILTIN_RESERVED, ...UTILITY_COMMANDS]);
		for (const command of pi.getCommands()) {
			if (!registeredRecipeCommandNames.has(command.name)) reserved.add(command.name);
		}
		return reserved;
	}

	function allocatePrefixedName(base: string, reserved: Set<string>): string {
		let candidate = `${COMMAND_PREFIX}${base}`;
		if (!reserved.has(candidate)) return candidate;
		let index = 2;
		while (reserved.has(`${candidate}-${index}`)) index += 1;
		return `${candidate}-${index}`;
	}

	function buildRecipeCommands(recipes: JustRecipe[]): RecipeCommand[] {
		const reserved = currentReservedNames();
		const rootNameCounts = new Map<string, number>();

		for (const recipe of recipes) {
			const safeName = safeCommandName(recipe.name);
			rootNameCounts.set(safeName, (rootNameCounts.get(safeName) ?? 0) + 1);
		}

		return recipes
			.sort((a, b) => a.namepath.localeCompare(b.namepath))
			.map((recipe) => {
				const safeName = safeCommandName(recipe.name);
				const safeNamePath = safeCommandName(recipe.namepath);
				const preferRootName = (rootNameCounts.get(safeName) ?? 0) === 1;
				const preferredBase = preferRootName ? safeName : safeNamePath;

				let commandName = preferredBase;
				let origin: RecipeCommand["origin"] = preferRootName ? "native-name" : "native-namepath";
				if (reserved.has(commandName)) {
					commandName = allocatePrefixedName(preferredBase, reserved);
					origin = "prefixed";
				}
				reserved.add(commandName);

				return {
					invokeName: recipe.namepath,
					displayName: recipe.namepath,
					commandName,
					description: buildDescription(recipe),
					usage: buildUsage(recipe),
					parameters: recipe.parameters ?? [],
					origin,
				};
			});
	}

	function hashRegistry(justfilePath: string | undefined, recipes: RecipeCommand[], scanError?: string): string {
		const hash = createHash("sha1");
		hash.update(JSON.stringify({
			justfilePath: justfilePath ?? null,
			scanError: scanError ?? null,
			recipes: recipes.map((recipe) => ({
				invokeName: recipe.invokeName,
				commandName: recipe.commandName,
				description: recipe.description,
				usage: recipe.usage,
				origin: recipe.origin,
			})),
		}));
		return hash.digest("hex");
	}

	async function pathExists(path: string): Promise<boolean> {
		try {
			await access(path);
			return true;
		} catch {
			return false;
		}
	}

	async function buildSearchDirs(cwd: string): Promise<string[]> {
		const dirs: string[] = [];
		const home = resolve(homedir());
		let current = resolve(cwd);

		while (true) {
			dirs.push(current);
			if (current === home) break;
			if (await pathExists(join(current, ".git"))) break;
			const parent = dirname(current);
			if (parent === current) break;
			current = parent;
		}

		return dirs;
	}

	async function findNearestJustfile(searchDirs: string[]): Promise<string | undefined> {
		for (const dir of searchDirs) {
			for (const candidate of CANDIDATE_JUSTFILES) {
				const fullPath = join(dir, candidate);
				if (await pathExists(fullPath)) return fullPath;
			}
		}
		return undefined;
	}

	function collectSourcePaths(value: unknown, paths = new Set<string>()): Set<string> {
		if (!value || typeof value !== "object") return paths;

		if (Array.isArray(value)) {
			for (const entry of value) collectSourcePaths(entry, paths);
			return paths;
		}

		const record = value as Record<string, unknown>;
		if (typeof record.source === "string") paths.add(resolve(record.source));
		if (record.modules && typeof record.modules === "object") collectSourcePaths(record.modules, paths);
		for (const entry of Object.values(record)) collectSourcePaths(entry, paths);
		return paths;
	}

	async function discoverRegistry(cwd: string): Promise<RegistryState> {
		const searchDirs = await buildSearchDirs(cwd);
		const justfilePath = await findNearestJustfile(searchDirs);
		if (!justfilePath) {
			return {
				...EMPTY_REGISTRY(cwd),
				cwd,
				searchDirs,
				hash: hashRegistry(undefined, []),
			};
		}

		const workingDirectory = dirname(justfilePath);
		try {
			const result = await pi.exec("just", ["--justfile", justfilePath, "--working-directory", workingDirectory, "--json"]);
			if (result.code !== 0) {
				const error = (result.stderr || result.stdout || "Failed to inspect justfile").trim();
				return {
					cwd,
					searchDirs,
					justfilePath,
					workingDirectory,
					watchFiles: [justfilePath],
					recipes: [],
					commandMap: new Map(),
					hash: hashRegistry(justfilePath, [], error),
					scanError: error,
					discoveredAt: Date.now(),
				};
			}

			const dump = JSON.parse(result.stdout) as JustDump;
			const rawRecipes = Object.values(dump.recipes ?? {}).filter((recipe) => !recipe.private);
			const recipes = buildRecipeCommands(rawRecipes);
			const watchFiles = Array.from(collectSourcePaths(dump));
			if (watchFiles.length === 0) watchFiles.push(justfilePath);

			return {
				cwd,
				searchDirs,
				justfilePath,
				workingDirectory,
				watchFiles,
				recipes,
				commandMap: new Map(recipes.map((recipe) => [recipe.commandName, recipe])),
				hash: hashRegistry(justfilePath, recipes),
				discoveredAt: Date.now(),
			};
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			return {
				cwd,
				searchDirs,
				justfilePath,
				workingDirectory,
				watchFiles: [justfilePath],
				recipes: [],
				commandMap: new Map(),
				hash: hashRegistry(justfilePath, [], message),
				scanError: message,
				discoveredAt: Date.now(),
			};
		}
	}

	function registerRecipeCommands(registry: RegistryState) {
		if (runtime.hideRecipeCommands) return;
		for (const recipe of registry.recipes) {
			if (registeredRecipeCommandNames.has(recipe.commandName)) continue;
			registeredRecipeCommandNames.add(recipe.commandName);
			pi.registerCommand(recipe.commandName, {
				description: recipe.description,
				handler: async (args, ctx) => {
					await runRecipe(recipe.commandName, args, ctx);
				},
			});
		}
	}

	async function writeTruncatedOutput(fullOutput: string): Promise<string | undefined> {
		try {
			const outputPath = join(tmpdir(), `pi-just-${Date.now()}-${randomUUID()}.log`);
			await writeFile(outputPath, fullOutput, "utf8");
			return outputPath;
		} catch {
			return undefined;
		}
	}

	function summarizeArgs(args: string[]): string {
		return args.length > 0 ? args.map(quoteForDisplay).join(" ") : "";
	}

	async function emitMessage(content: string, details: MessageDetails) {
		pi.sendMessage({
			customType: MESSAGE_TYPE,
			content,
			display: true,
			details,
		});
	}

	async function runRecipe(commandName: string, rawArgs: string, ctx: CommandContext) {
		const recipe = runtime.registry.commandMap.get(commandName);
		if (!recipe || !runtime.registry.justfilePath || !runtime.registry.workingDirectory) {
			await emitMessage(`/${commandName} is not available in this project`, {
				kind: "info",
				status: "warning",
				lines: [
					`No active just recipe is currently mapped to /${commandName}.`,
					runtime.registry.justfilePath
						? "The justfile changed and Pi is refreshing command mappings."
						: "No justfile was found for the current working directory.",
				],
			});
			return;
		}

		const parsedArgs = splitShellArgs(rawArgs);
		if (!parsedArgs.ok) {
			await emitMessage(`Could not parse arguments for /${commandName}`, {
				kind: "info",
				status: "error",
				lines: [parsedArgs.error],
			});
			return;
		}

		ctx.ui.setStatus(STATUS_ID, `just: running /${commandName}`);
		const startedAt = Date.now();
		const argsDisplay = summarizeArgs(parsedArgs.args);
		try {
			const result = await pi.exec(
				"just",
				[
					"--justfile",
					runtime.registry.justfilePath,
					"--working-directory",
					runtime.registry.workingDirectory,
					recipe.invokeName,
					...parsedArgs.args,
				],
				{ signal: ctx.signal },
			);

			const elapsedMs = Date.now() - startedAt;
			const combinedOutput = [result.stdout, result.stderr].filter(Boolean).join(result.stdout && result.stderr ? "\n" : "");
			const truncation = truncateTail(combinedOutput, {
				maxLines: DEFAULT_MAX_LINES,
				maxBytes: DEFAULT_MAX_BYTES,
			});
			let output = truncation.content;
			let fullOutputPath: string | undefined;
			if (truncation.truncated) {
				fullOutputPath = await writeTruncatedOutput(combinedOutput);
				const suffix = [
					`[output truncated: ${truncation.outputLines} of ${truncation.totalLines} lines`,
					`(${formatSize(truncation.outputBytes)} of ${formatSize(truncation.totalBytes)})`,
					fullOutputPath ? `full output: ${fullOutputPath}]` : "]",
				].join(" ");
				output = output ? `${output}\n\n${suffix}` : suffix;
			}

			await emitMessage(`/${commandName} → just ${recipe.invokeName}`, {
				kind: "run",
				status: result.code === 0 ? "success" : "error",
				commandName,
				recipeName: recipe.invokeName,
				argsDisplay,
				elapsedMs,
				exitCode: result.code,
				cwd: runtime.registry.workingDirectory,
				justfile: runtime.registry.justfilePath,
				output,
				truncated: truncation.truncated,
				truncatedLines: truncation.outputLines,
				totalLines: truncation.totalLines,
				truncatedBytes: truncation.outputBytes,
				totalBytes: truncation.totalBytes,
				fullOutputPath,
			});
		} catch (error) {
			const elapsedMs = Date.now() - startedAt;
			await emitMessage(`/${commandName} → just ${recipe.invokeName}`, {
				kind: "run",
				status: "error",
				commandName,
				recipeName: recipe.invokeName,
				argsDisplay,
				elapsedMs,
				exitCode: null,
				cwd: runtime.registry.workingDirectory,
				justfile: runtime.registry.justfilePath,
				output: error instanceof Error ? error.message : String(error),
			});
		} finally {
			setStatus(ctx);
		}
	}

	function splitShellArgs(input: string): { ok: true; args: string[] } | { ok: false; error: string } {
		const args: string[] = [];
		let current = "";
		let inSingle = false;
		let inDouble = false;
		let escaping = false;

		const push = () => {
			if (current.length > 0) {
				args.push(current);
				current = "";
			}
		};

		for (const char of input) {
			if (escaping) {
				current += char;
				escaping = false;
				continue;
			}

			if (char === "\\" && !inSingle) {
				escaping = true;
				continue;
			}

			if (char === "'" && !inDouble) {
				inSingle = !inSingle;
				continue;
			}

			if (char === '"' && !inSingle) {
				inDouble = !inDouble;
				continue;
			}

			if (!inSingle && !inDouble && /\s/.test(char)) {
				push();
				continue;
			}

			current += char;
		}

		if (escaping) current += "\\";
		if (inSingle || inDouble) return { ok: false, error: "Unterminated quote in slash-command arguments." };
		push();
		return { ok: true, args };
	}

	function parseSlashInvocation(text: string): { commandName: string; rawArgs: string } | undefined {
		if (!text.startsWith("/")) return undefined;
		const body = text.slice(1).trim();
		if (!body) return undefined;
		const firstSpace = body.search(/\s/);
		if (firstSpace === -1) return { commandName: body, rawArgs: "" };
		return {
			commandName: body.slice(0, firstSpace),
			rawArgs: body.slice(firstSpace + 1).trim(),
		};
	}

	function watchDirectory(dir: string, basenames: Set<string>) {
		try {
			const watcher = watch(dir, (_eventType, filename) => {
				if (filename) {
					const name = filename.toString();
					if (!basenames.has(name)) return;
				}
				scheduleRescan("file watcher");
			});
			runtime.watchers.push(watcher);
		} catch {
			// ignore watcher failures
		}
	}

	function rebuildWatchers() {
		clearWatchers();
		const watchedDirBasenames = new Map<string, Set<string>>();

		for (const searchDir of runtime.registry.searchDirs) {
			const set = watchedDirBasenames.get(searchDir) ?? new Set<string>();
			for (const candidate of CANDIDATE_JUSTFILES) set.add(candidate);
			watchedDirBasenames.set(searchDir, set);
		}

		for (const file of runtime.registry.watchFiles) {
			const resolved = resolve(file);
			const dir = dirname(resolved);
			const set = watchedDirBasenames.get(dir) ?? new Set<string>();
			set.add(resolved.split(/[/\\]/).pop() ?? resolved);
			watchedDirBasenames.set(dir, set);
		}

		runtime.watchedDirBasenames = watchedDirBasenames;
		for (const [dir, basenames] of watchedDirBasenames) watchDirectory(dir, basenames);
	}

	async function tryQueueRefresh(reason: string) {
		if (!AUTO_REFRESH || runtime.refreshQueued) return;
		runtime.refreshQueued = true;
		runtime.lastRefreshReason = reason;
		await emitMessage("Detected a justfile change", {
			kind: "info",
			status: "info",
			lines: ["Pi is refreshing slash-command mappings automatically.", `Reason: ${reason}`],
		});

		try {
			pi.sendUserMessage("/just-refresh", { deliverAs: "followUp" });
		} catch {
			try {
				pi.sendUserMessage("/just-refresh");
			} catch {
				runtime.refreshQueued = false;
			}
		}
	}

	async function handleRescan(reason: string) {
		const next = await discoverRegistry(runtime.cwd);
		const previous = runtime.registry;
		const changed =
			next.hash !== previous.hash ||
			next.justfilePath !== previous.justfilePath ||
			next.scanError !== previous.scanError;
		if (!changed) return;

		runtime.registry = next;
		if (!next.scanError) registerRecipeCommands(next);
		rebuildWatchers();

		if (next.scanError) {
			await emitMessage("justfile scan failed", {
				kind: "info",
				status: "error",
				lines: [next.scanError, "Current slash-command mappings were not reloaded yet."],
			});
			return;
		}

		await tryQueueRefresh(reason);
	}

	function scheduleRescan(reason: string) {
		if (runtime.rescanTimer) clearTimeout(runtime.rescanTimer);
		runtime.rescanTimer = setTimeout(() => {
			runtime.rescanTimer = undefined;
			void handleRescan(reason);
		}, WATCH_DEBOUNCE_MS);
	}

	pi.registerMessageRenderer(MESSAGE_TYPE, (message, { expanded }, theme) => {
		const details = message.details as MessageDetails | undefined;
		let text = theme.fg("accent", theme.bold("[just] ")) + message.content;

		if (details?.kind === "run") {
			const color = details.status === "success" ? "success" : "error";
			text =
				theme.fg("accent", theme.bold("[just] ")) +
				theme.fg(color, details.status === "success" ? "✓ " : "✗ ") +
				theme.bold(`/${details.commandName}`) +
				theme.fg("muted", ` → ${details.recipeName}`);
			if (details.argsDisplay) text += theme.fg("dim", ` ${details.argsDisplay}`);
			text +=
				"\n" +
				theme.fg(
					"dim",
					[
						details.exitCode === null ? "exit ?" : `exit ${details.exitCode}`,
						`${details.elapsedMs}ms`,
						details.justfile ? formatRelativePath(details.justfile) : undefined,
					]
						.filter(Boolean)
						.join(" • "),
				);
			if (expanded && details.output) {
				text += `\n\n${details.output}`;
				if (details.fullOutputPath) {
					text += `\n\n${theme.fg("dim", `full output: ${details.fullOutputPath}`)}`;
				}
			}
		} else if (details && (details.kind === "recipes" || details.kind === "watch" || details.kind === "info")) {
			const color =
				details.status === "error"
					? "error"
					: details.status === "warning"
						? "warning"
						: details.status === "success"
							? "success"
							: "accent";
			text = theme.fg("accent", theme.bold("[just] ")) + theme.fg(color, message.content);
			const lines = expanded ? details.lines : details.lines.slice(0, 12);
			if (lines.length > 0) text += `\n${lines.join("\n")}`;
			if (!expanded && details.lines.length > lines.length) {
				text += `\n${theme.fg("dim", `… ${details.lines.length - lines.length} more line(s)` )}`;
			}
		}

		const box = new Box(1, 1, (s) => theme.bg("customMessageBg", s));
		box.addChild(new Text(text, 0, 0));
		return box;
	});

	pi.on("context", async (event) => {
		return {
			messages: event.messages.filter((message) => {
				const msg = message as AgentMessage & { customType?: string };
				return msg.customType !== MESSAGE_TYPE;
			}),
		};
	});

	pi.registerCommand("just-refresh", {
		description: "Reload slash commands from the nearest justfile",
		handler: async (_args, ctx) => {
			runtime.refreshQueued = false;
			runtime.lastRefreshReason = undefined;
			await ctx.reload();
			return;
		},
	});

	if (runtime.hideRecipeCommands) {
		pi.registerCommand("just-unhide", {
			description: "Show auto-registered just recipe slash commands again",
			handler: async (_args, ctx) => {
				if (!runtime.hideRecipeCommands) {
					ctx.ui.notify("Just recipe slash commands are already visible", "info");
					return;
				}
				await saveConfig({ hideRecipeCommands: false });
				ctx.ui.notify("Showing just recipe slash commands and reloading…", "info");
				await ctx.reload();
				return;
			},
		});
	} else {
		pi.registerCommand("just-hide", {
			description: "Hide auto-registered just recipe slash commands (typed invocations still work)",
			handler: async (_args, ctx) => {
				if (runtime.hideRecipeCommands) {
					ctx.ui.notify("Just recipe slash commands are already hidden", "info");
					return;
				}
				await saveConfig({ hideRecipeCommands: true });
				ctx.ui.notify("Hiding just recipe slash commands and reloading…", "info");
				await ctx.reload();
				return;
			},
		});
	}

	pi.registerCommand("just-recipes", {
		description: "List detected just recipes and slash-command mappings",
		handler: async (args, _ctx) => {
			const filter = args.trim().toLowerCase();
			if (!runtime.registry.justfilePath) {
				await emitMessage("No justfile detected", {
					kind: "recipes",
					status: "warning",
					lines: [
						`Working directory: ${runtime.cwd}`,
						"Pi will stay idle until a justfile appears or you open a project that has one.",
					],
				});
				return;
			}

			const recipes = runtime.registry.recipes.filter((recipe) => {
				if (!filter) return true;
				return (
					recipe.commandName.includes(filter) ||
					recipe.invokeName.toLowerCase().includes(filter) ||
					recipe.description.toLowerCase().includes(filter)
				);
			});

			const lines = recipes.map((recipe) => {
				const alias = recipe.commandName === recipe.invokeName ? "" : ` -> ${recipe.invokeName}`;
				return `/${recipe.commandName}${alias}${recipe.description ? `  # ${recipe.description}` : ""}`;
			});
			const header = `${recipes.length} just recipe${recipes.length === 1 ? "" : "s"} from ${formatRelativePath(runtime.registry.justfilePath)}`;
			const extraLines = runtime.hideRecipeCommands
				? ["Auto-registered recipe slash commands are hidden. Typed invocations still work.", ""]
				: [];
			await emitMessage(header, {
				kind: "recipes",
				status: "info",
				lines: [...extraLines, ...lines],
			});
		},
	});

	pi.registerCommand("just-which", {
		description: "Show which just recipe backs a slash command",
		getArgumentCompletions: (prefix) => {
			const values = runtime.registry.recipes
				.flatMap((recipe) => [recipe.commandName, recipe.invokeName])
				.filter((value, index, array) => array.indexOf(value) === index)
				.filter((value) => value.startsWith(prefix));
			return values.length > 0 ? values.map((value) => ({ value, label: value })) : null;
		},
		handler: async (args, _ctx) => {
			const query = args.trim();
			if (!query) {
				await emitMessage("Usage: /just-which <command-or-recipe>", {
					kind: "info",
					status: "warning",
					lines: ["Example: /just-which ingest"],
				});
				return;
			}

			const normalized = query.replace(/^\//, "");
			const recipe =
				runtime.registry.commandMap.get(normalized) ??
				runtime.registry.recipes.find((entry) => entry.invokeName === normalized || entry.displayName === normalized);

			if (!recipe) {
				await emitMessage(`No just recipe found for ${query}`, {
					kind: "info",
					status: "warning",
					lines: runtime.registry.justfilePath
						? [`Nearest justfile: ${formatRelativePath(runtime.registry.justfilePath)}`]
						: ["No justfile is active in the current project."],
				});
				return;
			}

			const lines = [
				`slash command: /${recipe.commandName}`,
				`recipe: ${recipe.invokeName}`,
				`origin: ${recipe.origin}`,
				`registered: ${runtime.hideRecipeCommands ? "hidden" : "visible"}`,
				`usage: ${recipe.usage}`,
			];
			if (runtime.registry.justfilePath) lines.push(`justfile: ${formatRelativePath(runtime.registry.justfilePath)}`);
			await emitMessage(`/${recipe.commandName} maps to just ${recipe.invokeName}`, {
				kind: "info",
				status: "info",
				lines,
			});
		},
	});

	pi.registerCommand("just-watch", {
		description: "Show justfile watcher state",
		handler: async (_args, _ctx) => {
			const lines = [
				`cwd: ${runtime.cwd}`,
				`justfile: ${formatRelativePath(runtime.registry.justfilePath) ?? "none"}`,
				`recipes: ${runtime.registry.recipes.length}`,
				`recipe slash commands: ${runtime.hideRecipeCommands ? "hidden" : "visible"}`,
				`watch files: ${runtime.registry.watchFiles.length}`,
				`watch dirs: ${runtime.watchedDirBasenames.size}`,
				`refresh queued: ${runtime.refreshQueued ? "yes" : "no"}`,
			];
			if (runtime.lastRefreshReason) lines.push(`last refresh reason: ${runtime.lastRefreshReason}`);
			if (runtime.registry.scanError) lines.push(`scan error: ${runtime.registry.scanError}`);
			await emitMessage("Just watcher status", {
				kind: "watch",
				status: runtime.registry.scanError ? "error" : "info",
				lines,
			});
		},
	});

	pi.on("input", async (event, ctx) => {
		const invocation = parseSlashInvocation(event.text);
		if (!invocation) return { action: "continue" as const };
		const recipe = runtime.registry.commandMap.get(invocation.commandName);
		if (!recipe) return { action: "continue" as const };
		await runRecipe(invocation.commandName, invocation.rawArgs, ctx);
		return { action: "handled" as const };
	});

	pi.on("session_start", async (_event, ctx) => {
		runtime.cwd = ctx.cwd;
		runtime.refreshQueued = false;
		runtime.lastRefreshReason = undefined;
		runtime.hideRecipeCommands = (await loadConfig()).hideRecipeCommands;
		runtime.registry = await discoverRegistry(ctx.cwd);
		registerRecipeCommands(runtime.registry);
		rebuildWatchers();
		setStatus(ctx);
		if (runtime.registry.scanError) {
			ctx.ui.notify(`justfile scan failed: ${runtime.registry.scanError}`, "error");
		}
	});

	pi.on("session_shutdown", async () => {
		clearWatchers();
	});
}
