import type { AutocompleteItem, AutocompleteProvider, AutocompleteSuggestions } from "@mariozechner/pi-tui";
import { Editor } from "@mariozechner/pi-tui";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

type EditorPrototype = {
	isAtStartOfMessage?: (this: unknown) => boolean;
	isInSlashCommandContext?: (this: unknown, textBeforeCursor: string) => boolean;
	handleTabCompletion?: (this: unknown) => void;
	tryTriggerAutocomplete?: (this: unknown, explicitTab?: boolean) => void;
	state?: { lines?: string[]; cursorLine?: number; cursorCol?: number };
};

const PATCH_MARKER = Symbol.for("pi.inlineSlashAutocomplete.patchApplied");

type PatchablePrototype = EditorPrototype & { [PATCH_MARKER]?: boolean };

function inlineSlashMatch(textBeforeCursor: string): { token: string; start: number } | null {
	const match = textBeforeCursor.match(/(^|[ \t])(\/[^\s]*)$/);
	if (!match?.[2]) return null;

	const token = match[2];
	const start = textBeforeCursor.length - token.length;

	// Keep normal top-level slash-command behavior for lines that only contain
	// whitespace before the slash. This extension is for "prompt text /skill...".
	if (textBeforeCursor.slice(0, start).trim().length === 0) return null;

	return { token, start };
}

function patchEditorTriggering(): void {
	const prototype = Editor.prototype as PatchablePrototype;
	if (prototype[PATCH_MARKER]) return;
	prototype[PATCH_MARKER] = true;

	const originalIsAtStartOfMessage = prototype.isAtStartOfMessage;
	const originalIsInSlashCommandContext = prototype.isInSlashCommandContext;
	const originalHandleTabCompletion = prototype.handleTabCompletion;

	prototype.isAtStartOfMessage = function patchedIsAtStartOfMessage(this: EditorPrototype): boolean {
		if (originalIsAtStartOfMessage?.call(this)) return true;

		const lineIndex = this.state?.cursorLine ?? 0;
		if (lineIndex !== 0) return false;

		const line = this.state?.lines?.[lineIndex] ?? "";
		const col = this.state?.cursorCol ?? 0;
		const beforeCursor = line.slice(0, col);
		return inlineSlashMatch(beforeCursor) !== null;
	};

	prototype.isInSlashCommandContext = function patchedIsInSlashCommandContext(
		this: EditorPrototype,
		textBeforeCursor: string,
	): boolean {
		if (originalIsInSlashCommandContext?.call(this, textBeforeCursor)) return true;
		const lineIndex = this.state?.cursorLine ?? 0;
		return lineIndex === 0 && inlineSlashMatch(textBeforeCursor) !== null;
	};

	prototype.handleTabCompletion = function patchedHandleTabCompletion(this: EditorPrototype): void {
		const lineIndex = this.state?.cursorLine ?? 0;
		const line = this.state?.lines?.[lineIndex] ?? "";
		const col = this.state?.cursorCol ?? 0;
		const beforeCursor = line.slice(0, col);

		if (lineIndex === 0 && inlineSlashMatch(beforeCursor) !== null) {
			this.tryTriggerAutocomplete?.(true);
			return;
		}

		originalHandleTabCompletion?.call(this);
	};
}

function createInlineSlashProvider(current: AutocompleteProvider): AutocompleteProvider {
	return {
		async getSuggestions(lines, cursorLine, cursorCol, options): Promise<AutocompleteSuggestions | null> {
			const line = lines[cursorLine] ?? "";
			const beforeCursor = line.slice(0, cursorCol);
			const match = cursorLine === 0 ? inlineSlashMatch(beforeCursor) : null;

			if (!match) {
				return current.getSuggestions(lines, cursorLine, cursorCol, options);
			}

			// Ask the built-in provider for normal slash-command suggestions using
			// the slash token as a virtual line, then apply those suggestions inline.
			return current.getSuggestions([match.token], 0, match.token.length, options);
		},

		applyCompletion(lines, cursorLine, cursorCol, item: AutocompleteItem, prefix) {
			const line = lines[cursorLine] ?? "";
			const beforeCursor = line.slice(0, cursorCol);
			const match = cursorLine === 0 ? inlineSlashMatch(beforeCursor) : null;

			if (!match || prefix !== match.token) {
				return current.applyCompletion(lines, cursorLine, cursorCol, item, prefix);
			}

			const beforePrefix = line.slice(0, cursorCol - prefix.length);
			const afterCursor = line.slice(cursorCol);
			const newLine = `${beforePrefix}/${item.value} ${afterCursor}`;
			const newLines = [...lines];
			newLines[cursorLine] = newLine;

			return {
				lines: newLines,
				cursorLine,
				cursorCol: beforePrefix.length + item.value.length + 2,
			};
		},

		shouldTriggerFileCompletion(lines, cursorLine, cursorCol) {
			const line = lines[cursorLine] ?? "";
			const beforeCursor = line.slice(0, cursorCol);
			if (cursorLine === 0 && inlineSlashMatch(beforeCursor) !== null) return true;
			return current.shouldTriggerFileCompletion?.(lines, cursorLine, cursorCol) ?? true;
		},
	};
}

export default function inlineSlashAutocomplete(pi: ExtensionAPI) {
	patchEditorTriggering();

	pi.on("session_start", (_event, ctx) => {
		ctx.ui.addAutocompleteProvider(createInlineSlashProvider);
	});
}
