import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir, platform } from "node:os";
import { dirname, join } from "node:path";
import { spawn } from "node:child_process";

const CONFIG_FILE = join(homedir(), ".pi", "agent", "notifications.json");

type Toggle = "on" | "off" | "toggle";

type NotificationConfig = {
	enabled: boolean;
	desktop: {
		enabled: boolean;
		title: string;
		message: string;
		includeResponsePreview: boolean;
		responseWordCount: number;
	};
	audio: {
		enabled: boolean;
		sound: string;
	};
};

const DEFAULT_CONFIG: NotificationConfig = {
	enabled: true,
	desktop: {
		enabled: true,
		title: "pi",
		message: "Turn complete",
		includeResponsePreview: true,
		responseWordCount: 8,
	},
	audio: {
		enabled: false,
		sound: "Glass",
	},
};

function isObject(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readString(value: unknown, fallback: string): string {
	return typeof value === "string" && value.length > 0 ? value : fallback;
}

function readBoolean(value: unknown, fallback: boolean): boolean {
	return typeof value === "boolean" ? value : fallback;
}

function readPositiveInteger(value: unknown, fallback: number): number {
	return typeof value === "number" && Number.isInteger(value) && value > 0 ? value : fallback;
}

function mergeConfig(value: unknown): NotificationConfig {
	if (!isObject(value)) return DEFAULT_CONFIG;

	const desktop = isObject(value.desktop) ? value.desktop : {};
	const audio = isObject(value.audio) ? value.audio : {};

	return {
		enabled: readBoolean(value.enabled, DEFAULT_CONFIG.enabled),
		desktop: {
			enabled: readBoolean(desktop.enabled, DEFAULT_CONFIG.desktop.enabled),
			title: readString(desktop.title, DEFAULT_CONFIG.desktop.title),
			message: readString(desktop.message, DEFAULT_CONFIG.desktop.message),
			includeResponsePreview: readBoolean(
				desktop.includeResponsePreview,
				DEFAULT_CONFIG.desktop.includeResponsePreview,
			),
			responseWordCount: readPositiveInteger(desktop.responseWordCount, DEFAULT_CONFIG.desktop.responseWordCount),
		},
		audio: {
			enabled: readBoolean(audio.enabled, DEFAULT_CONFIG.audio.enabled),
			sound: readString(audio.sound, DEFAULT_CONFIG.audio.sound),
		},
	};
}

function loadConfig(): NotificationConfig {
	try {
		if (!existsSync(CONFIG_FILE)) return DEFAULT_CONFIG;
		return mergeConfig(JSON.parse(readFileSync(CONFIG_FILE, "utf8")));
	} catch {
		return DEFAULT_CONFIG;
	}
}

function saveConfig(config: NotificationConfig): void {
	mkdirSync(dirname(CONFIG_FILE), { recursive: true });
	writeFileSync(CONFIG_FILE, `${JSON.stringify(config, null, 2)}\n`);
}

function applyToggle(value: boolean, toggle: Toggle): boolean {
	if (toggle === "on") return true;
	if (toggle === "off") return false;
	return !value;
}

function isToggle(value: string): value is Toggle {
	return value === "on" || value === "off" || value === "toggle";
}

function runDetached(command: string, args: string[]): void {
	try {
		const child = spawn(command, args, { detached: true, stdio: "ignore" });
		child.on("error", () => {});
		child.unref();
	} catch {
		// Notifications should never interrupt pi.
	}
}

function shellEscapeForAppleScript(value: string): string {
	return value.replace(/\\/g, "\\\\").replace(/"/g, "\\\"");
}

function sendDesktopNotification(config: NotificationConfig, responsePreview?: string): void {
	const system = platform();
	const title = config.desktop.title;
	const message = responsePreview ? `${config.desktop.message}: ${responsePreview}` : config.desktop.message;

	if (system === "darwin") {
		runDetached("osascript", [
			"-e",
			`display notification "${shellEscapeForAppleScript(message)}" with title "${shellEscapeForAppleScript(title)}"`,
		]);
		return;
	}

	if (system === "linux") {
		runDetached("notify-send", [title, message]);
		return;
	}

	process.stdout.write("\u0007");
}

function playAudio(config: NotificationConfig): void {
	const system = platform();
	const sound = config.audio.sound;

	if (system === "darwin") {
		runDetached("afplay", [`/System/Library/Sounds/${sound}.aiff`]);
		return;
	}

	if (system === "linux") {
		runDetached("paplay", ["/usr/share/sounds/freedesktop/stereo/complete.oga"]);
		return;
	}

	process.stdout.write("\u0007");
}

function notifyTurnComplete(config: NotificationConfig, responsePreview?: string): void {
	if (!config.enabled) return;
	if (config.desktop.enabled) sendDesktopNotification(config, responsePreview);
	if (config.audio.enabled) playAudio(config);
}

function getTextFromContent(content: unknown): string {
	if (typeof content === "string") return content;
	if (!Array.isArray(content)) return "";

	return content
		.map((part) => {
			if (!isObject(part) || part.type !== "text") return "";
			return typeof part.text === "string" ? part.text : "";
		})
		.filter(Boolean)
		.join(" ");
}

function getResponsePreview(messages: unknown[], wordCount: number): string | undefined {
	for (let i = messages.length - 1; i >= 0; i -= 1) {
		const message = messages[i];
		if (!isObject(message) || message.role !== "assistant") continue;

		const text = getTextFromContent(message.content).replace(/\s+/g, " ").trim();
		if (!text) continue;

		const words = text.split(" ").slice(0, wordCount).join(" ");
		return text.split(" ").length > wordCount ? `${words}...` : words;
	}

	return undefined;
}

function formatStatus(config: NotificationConfig): string {
	return [
		`notifications: ${config.enabled ? "on" : "off"}`,
		`desktop: ${config.desktop.enabled ? "on" : "off"}`,
		`audio: ${config.audio.enabled ? "on" : "off"}`,
		`config: ${CONFIG_FILE}`,
	].join(" | ");
}

export default function notifications(pi: ExtensionAPI): void {
	let config = loadConfig();

	pi.registerCommand("notifications", {
		description: "Configure turn-complete notifications: /notifications status|on|off|desktop on|audio on|test|config",
		getArgumentCompletions: (prefix) => {
			const options = [
				"status",
				"on",
				"off",
				"toggle",
				"desktop on",
				"desktop off",
				"desktop toggle",
				"audio on",
				"audio off",
				"audio toggle",
				"test",
				"config",
				"reload",
			];
			const normalized = prefix.trim().toLowerCase();
			const items = options
				.filter((option) => option.startsWith(normalized))
				.map((option) => ({ value: option, label: option }));
			return items.length ? items : null;
		},
		handler: async (args, ctx) => {
			const parts = args.trim().toLowerCase().split(/\s+/).filter(Boolean);
			const [first, second] = parts;

			if (!first || first === "status") {
				ctx.ui.notify(formatStatus(config), "info");
				return;
			}

			if (first === "config") {
				saveConfig(config);
				ctx.ui.notify(`Notification config: ${CONFIG_FILE}`, "info");
				return;
			}

			if (first === "reload") {
				config = loadConfig();
				ctx.ui.notify(`Reloaded. ${formatStatus(config)}`, "info");
				return;
			}

			if (first === "test") {
				notifyTurnComplete(config);
				ctx.ui.notify("Sent notification test", "info");
				return;
			}

			if (isToggle(first)) {
				config = { ...config, enabled: applyToggle(config.enabled, first) };
				saveConfig(config);
				ctx.ui.notify(formatStatus(config), "info");
				return;
			}

			if ((first === "desktop" || first === "audio") && second && isToggle(second)) {
				config = {
					...config,
					[first]: { ...config[first], enabled: applyToggle(config[first].enabled, second) },
				};
				saveConfig(config);
				ctx.ui.notify(formatStatus(config), "info");
				return;
			}

			ctx.ui.notify("Usage: /notifications status|on|off|toggle|desktop on|audio on|test|config|reload", "error");
		},
	});

	pi.on("agent_end", (event) => {
		config = loadConfig();
		const responsePreview = config.desktop.includeResponsePreview
			? getResponsePreview(event.messages, config.desktop.responseWordCount)
			: undefined;
		notifyTurnComplete(config, responsePreview);
	});
}
