/**
 * Thinking-format policy: what a provider *declares* versus what a host can send.
 *
 * Providers name their reasoning mechanism freely (`kimi`, `gemini-level`,
 * `minimax`, `step` all appear in real catalogs). Pi supports a fixed set. The
 * gap is deliberate and visible: an unmapped format produces no effort menu
 * rather than a plausible-looking wrong parameter. See `docs/THINKING.md`.
 */
export type PiThinkingFormat =
	| "openai"
	| "deepseek"
	| "qwen"
	| "zai"
	| "openrouter"
	| "together"
	| "baseten"
	| "chat-template"
	| "qwen-chat-template"
	| "string-thinking"
	| "ant-ling";

export const PI_THINKING_FORMATS: ReadonlySet<string> = new Set<PiThinkingFormat>([
	"openai",
	"deepseek",
	"qwen",
	"zai",
	"openrouter",
	"together",
	"baseten",
	"chat-template",
	"qwen-chat-template",
	"string-thinking",
	"ant-ling",
]);

/** Declared format -> the host format that produces the same wire behaviour. */
export const DECLARED_TO_PI: Readonly<Record<string, PiThinkingFormat>> = {
	openai: "openai",
	deepseek: "deepseek",
	qwen: "qwen",
	zai: "zai",
};

export interface ThinkingMapping {
	/** Set only when the host can reproduce the declared behaviour. */
	pi?: PiThinkingFormat;
	/** `unmapped`: the host has no equivalent. `none`: the provider declared none. */
	reason?: "unmapped" | "none";
	declared: string;
}

/**
 * Maps a declared format to a host format.
 *
 * `overrides` lets a pack record a measured equivalence, for example
 * `{ kimi: "openai" }` once a probe shows Kimi honours `reasoning_effort`. Do not
 * add an override without an entry in `docs/THINKING.md`.
 */
export function mapThinkingFormat(
	declared: string | undefined,
	overrides: Readonly<Record<string, PiThinkingFormat>> = {},
): ThinkingMapping {
	if (declared === undefined || declared.trim().length === 0) {
		return { reason: "none", declared: "" };
	}
	const key = declared.trim().toLowerCase();
	const mapped = overrides[key] ?? DECLARED_TO_PI[key];
	if (mapped !== undefined && PI_THINKING_FORMATS.has(mapped)) {
		return { pi: mapped, declared: key };
	}
	return { reason: "unmapped", declared: key };
}

/** Formats a probe still has to resolve before this repo can claim support. */
export function unmappedFormats(
	declared: readonly (string | undefined)[],
	overrides: Readonly<Record<string, PiThinkingFormat>> = {},
): string[] {
	const seen = new Set<string>();
	for (const format of declared) {
		const mapping = mapThinkingFormat(format, overrides);
		if (mapping.reason === "unmapped") seen.add(mapping.declared);
	}
	return [...seen].sort();
}
