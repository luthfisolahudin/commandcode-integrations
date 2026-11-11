import { declaredEffortMenu, effortMenu, mapThinkingFormat, type NormalizedModel } from "@luthfisolahudin/commandcode-integrations-contract";

/** Pi's chat-model shape, kept structural so projection tests need no host SDK. */
/** The APIs this adapter can drive; a model picks one through the pack's route hook. */
export type PiApi = "openai-completions" | "anthropic-messages" | "openai-responses";

export interface PiModel {
	type: "chat";
	id: string;
	name: string;
	provider: string;
	api: PiApi;
	baseUrl: string;
	reasoning: boolean;
	input: ("text" | "image")[];
	cost: { input: number; output: number; cacheRead: number; cacheWrite: number };
	contextWindow: number;
	maxTokens: number;
	thinkingLevelMap?: Record<string, string | null>;
	compat?: Record<string, unknown>;
}

export const ZERO_COST = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } as const;

export interface HostOptions {
	providerId: string;
	baseUrl: string;
	api?: PiApi;
	/** Provider-level compatibility defaults, overridable per model. */
	compat?: Record<string, unknown>;
	/** Measured format equivalences declared by the pack. */
	thinkingFormatOverrides?: Record<string, string>;
}

export interface ProjectOptions extends HostOptions {
	/** Measured wire effort for this model, if any. See the provider's `effort.ts`. */
	wireEffort?: string;
}

/**
 * Projects one normalised model into Pi's shape, or `undefined` when the model
 * should not be registered (excluded by the pack, e.g. offline or non-chat).
 *
 * Thinking policy:
 * - a declared format Pi can reproduce gets `compat.thinkingFormat`;
 * - an effort menu exists only when a probe measured a wire value;
 * - an unmapped format gets no menu: the model still reports thinking content,
 *   but the integration does not claim it can shape it.
 */
export function toPiModel(model: NormalizedModel, options: ProjectOptions): PiModel | undefined {
	if (model.excluded !== undefined) return undefined;

	const projected: PiModel = {
		type: "chat",
		id: model.id,
		name: model.name,
		provider: options.providerId,
		api: (model.api as PiApi | undefined) ?? options.api ?? "openai-completions",
		baseUrl: options.baseUrl,
		reasoning: model.reasoning,
		input: model.input.filter((m): m is "text" | "image" => m === "text" || m === "image"),
		cost: { ...model.cost },
		contextWindow: model.contextWindow,
		maxTokens: model.maxOutput,
	};

	if (!model.reasoning) return projected;

	const mapping = mapThinkingFormat(
		model.thinking.format,
		(options.thinkingFormatOverrides ?? {}) as Record<string, never>,
	);
	// A measurement wins. Without one, the levels the provider declares are used,
	// but only when Pi can send that format: an effort menu on an unmapped format
	// would advertise behaviour this integration cannot ask for.
	const menu =
		options.wireEffort !== undefined
			? effortMenu({ wireEffort: options.wireEffort, canDisable: model.thinking.canDisable })
			: mapping.pi === undefined || model.thinking.efforts === undefined
				? undefined
				: declaredEffortMenu(model.thinking.efforts, model.thinking.canDisable);
	const compat: Record<string, unknown> = { ...options.compat };

	if (mapping.pi !== undefined) {
		compat.thinkingFormat = mapping.pi;
		if (menu !== undefined) {
			compat.supportsReasoningEffort = true;
			projected.thinkingLevelMap = menu;
		}
	}
	if (Object.keys(compat).length > 0) projected.compat = compat;
	return projected;
}

/** Builds the model list a host registers, dropping exclusions. */
export function toPiModels(
	models: readonly NormalizedModel[],
	effort: Readonly<Record<string, string>>,
	options: HostOptions,
): PiModel[] {
	const projected: PiModel[] = [];
	for (const model of models) {
		const wireEffort = effort[model.id];
		const entry = toPiModel(model, {
			...options,
			...(wireEffort === undefined ? {} : { wireEffort }),
		});
		if (entry !== undefined) projected.push(entry);
	}
	return projected;
}
