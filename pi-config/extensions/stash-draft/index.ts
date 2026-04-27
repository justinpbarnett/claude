import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";
import { matchesKey } from "@mariozechner/pi-tui";

const STATUS = {
	stashed: "Stashed editor text; it will restore after your next submitted message",
	restored: "Restored stashed editor text",
	noText: "No editor text to stash",
} as const;

export default function (pi: ExtensionAPI) {
	let stashedText: string | undefined;

	function stashOrRestore(ctx: ExtensionContext): boolean {
		if (!ctx.hasUI) return false;

		const currentText = ctx.ui.getEditorText();
		if (currentText.trim()) {
			stashedText = currentText;
			ctx.ui.setEditorText("");
			ctx.ui.notify(STATUS.stashed, "info");
			return true;
		}

		if (stashedText !== undefined) {
			ctx.ui.setEditorText(stashedText);
			stashedText = undefined;
			ctx.ui.notify(STATUS.restored, "info");
			return true;
		}

		ctx.ui.notify(STATUS.noText, "info");
		return true;
	}

	pi.on("session_start", (_event, ctx) => {
		if (!ctx.hasUI) return;

		ctx.ui.onTerminalInput((data) => {
			if (!matchesKey(data, "ctrl+s")) {
				return undefined;
			}

			return stashOrRestore(ctx) ? { consume: true } : undefined;
		});
	});

	pi.on("input", (event, ctx) => {
		if (!ctx.hasUI || event.source !== "interactive" || stashedText === undefined) {
			return { action: "continue" };
		}

		const textToRestore = stashedText;
		stashedText = undefined;
		ctx.ui.setEditorText(textToRestore);
		return { action: "continue" };
	});
}
