import { mapThinkingFormat, PI_LEVELS, type NormalizedModel } from "@luthfisolahudin/commandcode-integrations-contract";

/**
 * OpenCode's model shape, kept structural on purpose.
 *
 * The host's schema is Effect-typed and changes between minor releases; the
 * template pins the subset it fills and every field is asserted by the
 * projection tests. Anything the host adds with a default stays the host's job.
 */
export interface OpencodeModel {
	id: string;
	name: string;
	/** Per-model host package when a provider mixes wire protocols. */
	package?: string;
	capabilities: {
		tools: boolean;
		input: string[];
		output: string[];
		reasoning?: { supported: boolean; effort?: string[] };
	};
	limit: { context: number; output: number };
}

export interface OpencodeProviderInfo {
	id: string;
	name: string;
	activation: "enabled";
	package: string;
	settings: { baseURL: string; apiKey?: string };
}

export const DEFAULT_PACKAGE = "@opencode/ai/providers/openai-compatible";

/** Maps a wire api to the OpenCode package that speaks it. */
export const PACKAGE_BY_API: Readonly<Record<string, string>> = {
	"openai-completions": DEFAULT_PACKAGE,
	"anthropic-messages": "@opencode/ai/providers/anthropic-compatible",
	"openai-responses": "@opencode/ai/providers/openai-compatible/responses",
};

/**
 * Effort levels OpenCode may offer. Only measured levels are advertised, so a
 * model with no probe gets no effort list at all.
 */
export function effortLevels(wireEffort: string | undefined, canDisable: boolean | undefined): string[] | undefined {
	if (wireEffort === undefined) return undefined;
	return [wireEffort, ...(canDisable === false ? [] : [])];
}

export function toOpencodeModel(
	model: NormalizedModel,
	forcedEffort?: string,
	thinkingFormatOverrides?: Record<string, string>,
): OpencodeModel | undefined {
	if (model.excluded !== undefined) return undefined;

	const projected: OpencodeModel = {
		id: model.id,
		...(model.api === undefined || PACKAGE_BY_API[model.api] === undefined
			? {}
			: { package: PACKAGE_BY_API[model.api] }),
		name: model.name,
		capabilities: {
			tools: model.tools ?? true,
			input: [...model.input],
			output: [...model.output],
		},
		limit: { context: model.contextWindow, output: model.maxOutput },
	};

	if (!model.reasoning) return projected;

	const mapping = mapThinkingFormat(model.thinking.format, (thinkingFormatOverrides ?? {}) as Record<string, never>);
	const mappable = mapping.pi !== undefined;
	const measured = effortLevels(forcedEffort, model.thinking.canDisable);
	// Measured levels win; otherwise advertise the provider's declared ones. Both
	// require a format this integration can actually send.
	const declared =
		model.thinking.efforts === undefined
			? undefined
			: model.thinking.efforts.filter((level) => !/^(none|off|disabled?)$/i.test(level));
	const levels = !mappable
		? undefined
		: (measured ?? (declared !== undefined && declared.length > 0 ? declared : undefined));
	projected.capabilities.reasoning = {
		supported: true,
		...(levels === undefined ? {} : { effort: levels }),
	};
	return projected;
}

export function toOpencodeModels(
	models: readonly NormalizedModel[],
	effort: Readonly<Record<string, string>>,
	thinkingFormatOverrides?: Record<string, string>,
): OpencodeModel[] {
	const projected: OpencodeModel[] = [];
	for (const model of models) {
		const entry = toOpencodeModel(model, effort[model.id], thinkingFormatOverrides);
		if (entry !== undefined) projected.push(entry);
	}
	return projected;
}

/** Every level the host knows about, for the provider-level capability block. */
export const KNOWN_EFFORTS: readonly string[] = PI_LEVELS.filter((level) => level !== "off");
