type ProviderRequestEvent = {
	payload: unknown;
};

type ProviderRequestContext = {
	model?: {
		api?: string;
		provider?: string;
	};
};

type PiExtensionApi = {
	on(
		event: "before_provider_request",
		handler: (event: ProviderRequestEvent, ctx: ProviderRequestContext) => unknown,
	): void;
};

type JsonObject = Record<string, unknown>;

const UNSUPPORTED_FIREWORKS_TOOL_FIELDS = new Set([
	"allowed_callers",
	"cache_control",
	"defer_loading",
	"eager_input_streaming",
	"input_examples",
]);

function isObject(value: unknown): value is JsonObject {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isFireworksAnthropicRequest(event: ProviderRequestEvent, ctx: ProviderRequestContext): boolean {
	if (ctx.model?.provider === "fireworks" && ctx.model.api === "anthropic-messages") {
		return true;
	}

	const payload = event.payload;
	return isObject(payload) && typeof payload.model === "string" && payload.model.startsWith("accounts/fireworks/");
}

function stripUnsupportedToolFields(tool: unknown): { tool: unknown; changed: boolean } {
	if (!isObject(tool)) {
		return { tool, changed: false };
	}

	let changed = false;
	const nextTool: JsonObject = {};

	for (const [key, value] of Object.entries(tool)) {
		if (UNSUPPORTED_FIREWORKS_TOOL_FIELDS.has(key)) {
			changed = true;
			continue;
		}

		nextTool[key] = value;
	}

	return changed ? { tool: nextTool, changed } : { tool, changed: false };
}

function sanitizePayload(payload: unknown): unknown {
	if (!isObject(payload) || !Array.isArray(payload.tools)) {
		return payload;
	}

	let changed = false;
	const tools = payload.tools.map((tool) => {
		const result = stripUnsupportedToolFields(tool);
		changed ||= result.changed;
		return result.tool;
	});

	return changed ? { ...payload, tools } : payload;
}

export default function fireworksCompat(pi: PiExtensionApi): void {
	pi.on("before_provider_request", (event, ctx) => {
		if (!isFireworksAnthropicRequest(event, ctx)) {
			return;
		}

		const payload = sanitizePayload(event.payload);
		if (payload !== event.payload) {
			return payload;
		}
	});
}
