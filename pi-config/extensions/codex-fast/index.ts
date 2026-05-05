import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

type JsonObject = Record<string, unknown>;
type FastState = { enabled: boolean };

const STATE_FILE = join(homedir(), ".pi", "agent", "codex-fast.json");
const CODEX_FAST_SERVICE_TIER = "priority";

function isObject(value: unknown): value is JsonObject {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function loadState(): FastState {
	try {
		if (!existsSync(STATE_FILE)) return { enabled: false };

		const parsed = JSON.parse(readFileSync(STATE_FILE, "utf8")) as Partial<FastState>;
		return { enabled: parsed.enabled === true };
	} catch {
		return { enabled: false };
	}
}

function saveState(state: FastState): void {
	mkdirSync(dirname(STATE_FILE), { recursive: true });
	writeFileSync(STATE_FILE, `${JSON.stringify(state, null, 2)}\n`);
}

function isOpenAICodex(ctx: ExtensionContext, payload: unknown): boolean {
	if (ctx.model?.provider === "openai-codex") return true;
	return isObject(payload) && typeof payload.model === "string" && ctx.model?.api === "openai-codex-responses";
}

function withFastServiceTier(payload: JsonObject): JsonObject {
	return { ...payload, service_tier: CODEX_FAST_SERVICE_TIER };
}

function withoutFastServiceTier(payload: JsonObject): JsonObject {
	if (!("service_tier" in payload)) return payload;

	const next = { ...payload };
	delete next.service_tier;
	return next;
}

function formatTokens(count: number): string {
	if (count < 1000) return count.toString();
	if (count < 10000) return `${(count / 1000).toFixed(1)}k`;
	if (count < 1000000) return `${Math.round(count / 1000)}k`;
	if (count < 10000000) return `${(count / 1000000).toFixed(1)}M`;
	return `${Math.round(count / 1000000)}M`;
}

function visibleWidth(text: string): number {
	return text.length;
}

function truncateToWidth(text: string, width: number, ellipsis = "..."): string {
	if (text.length <= width) return text;
	if (width <= 0) return "";
	if (width <= ellipsis.length) return ellipsis.slice(0, width);
	return `${text.slice(0, width - ellipsis.length)}${ellipsis}`;
}

function installFooter(ctx: ExtensionContext, getState: () => FastState, getThinkingLevel: () => string): void {
	ctx.ui.setFooter((tui, theme, footerData) => {
		const unsubscribe = footerData.onBranchChange(() => tui.requestRender());

		return {
			dispose: unsubscribe,
			invalidate() {},
			render(width: number): string[] {
				let totalInput = 0;
				let totalOutput = 0;
				let totalCacheRead = 0;
				let totalCacheWrite = 0;
				let totalCost = 0;

				for (const entry of ctx.sessionManager.getEntries()) {
					if (entry.type === "message" && entry.message.role === "assistant") {
						totalInput += entry.message.usage.input;
						totalOutput += entry.message.usage.output;
						totalCacheRead += entry.message.usage.cacheRead;
						totalCacheWrite += entry.message.usage.cacheWrite;
						totalCost += entry.message.usage.cost.total;
					}
				}

				let pwd = ctx.cwd;
				if (pwd.startsWith(homedir())) pwd = `~${pwd.slice(homedir().length)}`;

				const branch = footerData.getGitBranch();
				if (branch) pwd = `${pwd} (${branch})`;

				const sessionName = ctx.sessionManager.getSessionName();
				if (sessionName) pwd = `${pwd} • ${sessionName}`;

				const statsParts: string[] = [];
				if (totalInput) statsParts.push(`↑${formatTokens(totalInput)}`);
				if (totalOutput) statsParts.push(`↓${formatTokens(totalOutput)}`);
				if (totalCacheRead) statsParts.push(`R${formatTokens(totalCacheRead)}`);
				if (totalCacheWrite) statsParts.push(`W${formatTokens(totalCacheWrite)}`);
				if (totalCost) statsParts.push(`$${totalCost.toFixed(3)}`);

				const usage = ctx.getContextUsage();
				const contextWindow = usage?.contextWindow ?? ctx.model?.contextWindow ?? 0;
				const contextPercent = usage?.percent == null ? "?" : usage.percent.toFixed(1);
				statsParts.push(`${contextPercent}%/${formatTokens(contextWindow)}`);

				let statsLeft = statsParts.join(" ");
				if (visibleWidth(statsLeft) > width) statsLeft = truncateToWidth(statsLeft, width, "...");

				const modelName = ctx.model?.id ?? "no-model";
				const tier = ctx.model?.provider === "openai-codex" ? (getState().enabled ? "fast" : "standard") : undefined;
				const modelParts = [modelName];
				if (tier) modelParts.push(tier);
				if (ctx.model?.reasoning) {
					const thinkingLevel = getThinkingLevel();
					modelParts.push(thinkingLevel === "off" ? "thinking off" : thinkingLevel);
				}

				let rightSide = modelParts.join(" • ");
				if (footerData.getAvailableProviderCount() > 1 && ctx.model) {
					rightSide = `(${ctx.model.provider}) ${rightSide}`;
				}

				const leftWidth = visibleWidth(statsLeft);
				const rightWidth = visibleWidth(rightSide);
				const padding = " ".repeat(Math.max(2, width - leftWidth - rightWidth));
				const statsLine = truncateToWidth(statsLeft + padding + rightSide, width, "");

				return [
					truncateToWidth(theme.fg("dim", pwd), width, theme.fg("dim", "...")),
					theme.fg("dim", statsLine),
				];
			},
		};
	});
}

export default function codexFast(pi: ExtensionAPI): void {
	let state = loadState();

	pi.on("session_start", (_event, ctx) => {
		if (ctx.hasUI) installFooter(ctx, () => state, () => pi.getThinkingLevel());
	});

	pi.registerCommand("fast", {
		description: "Enable/disable OpenAI Codex Fast Mode: /fast on|off|status",
		getArgumentCompletions: (prefix) => {
			const options = ["on", "off", "status"];
			const items = options
				.filter((option) => option.startsWith(prefix.trim().toLowerCase()))
				.map((option) => ({ value: option, label: option }));
			return items.length ? items : null;
		},
		handler: async (args, ctx) => {
			const arg = args.trim().toLowerCase();

			if (arg === "on") {
				state = { enabled: true };
				saveState(state);
				ctx.ui.notify("OpenAI Codex Fast Mode enabled for future requests", "success");
				return;
			}

			if (arg === "off") {
				state = { enabled: false };
				saveState(state);
				ctx.ui.notify("OpenAI Codex Fast Mode disabled for future requests", "info");
				return;
			}

			if (arg === "" || arg === "status") {
				ctx.ui.notify(`OpenAI Codex Fast Mode: ${state.enabled ? "on" : "off"}`, "info");
				return;
			}

			ctx.ui.notify("Usage: /fast on | /fast off | /fast status", "error");
		},
	});

	pi.on("before_provider_request", (event, ctx) => {
		if (!isOpenAICodex(ctx, event.payload) || !isObject(event.payload)) return;

		return state.enabled ? withFastServiceTier(event.payload) : withoutFastServiceTier(event.payload);
	});
}
