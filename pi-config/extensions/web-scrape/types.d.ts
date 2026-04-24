declare module "jsdom" {
	export class JSDOM {
		constructor(html?: string, options?: unknown);
		window: {
			document: Document;
		};
	}
}

declare module "turndown" {
	export default class TurndownService {
		constructor(options?: unknown);
		turndown(input: string): string;
		use(plugin: unknown): this;
	}
}

declare module "turndown-plugin-gfm" {
	export const gfm: unknown;
}
