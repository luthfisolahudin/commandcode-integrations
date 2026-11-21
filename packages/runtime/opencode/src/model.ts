import { Model, Provider } from "@opencode/plugin";
import { mapThinkingFormat, type NormalizedModel } from "@luthfisolahudin/ai-integrations-contract";

export const DEFAULT_PACKAGE = "@opencode/ai/providers/openai-compatible";

export const PACKAGE_BY_API: Readonly<Record<string, string>> = {
	"openai-completions": DEFAULT_PACKAGE,
	"anthropic-messages": "@opencode/ai/providers/anthropic-compatible",
	"openai-responses": "@opencode/ai/providers/openai-compatible/responses",
};

export function toOpencodeModel(
	model: NormalizedModel,
	forcedEffort?: string,
	thinkingFormatOverrides?: Record<string, string>,
	defaultPackage = DEFAULT_PACKAGE,
): Model.Info | undefined {
	if (model.excluded !== undefined) return undefined;
	const route = model.api ?? "openai-completions";
	const pkg = model.api === undefined ? undefined : route === "openai-completions" ? defaultPackage : PACKAGE_BY_API[route];
	if (!Object.hasOwn(PACKAGE_BY_API, route)) return undefined;

	const format = mapThinkingFormat(model.thinking.format, thinkingFormatOverrides as Record<string, never> | undefined);
	const levels = forcedEffort === undefined ? model.thinking.efforts ?? [] : [forcedEffort];
	const variants = model.reasoning && (format.pi !== undefined || route !== "openai-completions")
		? levels.map((effort) => {
			const disabled = /^(none|off|disabled?)$/i.test(effort);
			const settings = route === "anthropic-messages"
				? disabled ? { thinking: { type: "disabled" } } : { thinking: { type: "adaptive", display: "summarized" }, effort }
				: { reasoningEffort: disabled && route === "openai-responses" ? "none" : effort };
			return { id: Model.VariantID.make(disabled ? "none" : effort), settings };
		})
		: [];
	return {
		...Model.Info.default(Provider.ID.make(model.providerId), Model.ID.make(model.id)),
		name: model.name,
		package: pkg,
		capabilities: { tools: model.tools === true, input: [...model.input], output: [...model.output] },
		limit: { context: model.contextWindow, output: model.maxOutput },
		variants,
	};
}

export function toOpencodeModels(
	models: readonly NormalizedModel[],
	effort: Readonly<Record<string, string>>,
	thinkingFormatOverrides?: Record<string, string>,
	defaultPackage = DEFAULT_PACKAGE,
): Model.Info[] {
	return models.flatMap((model) => {
		const projected = toOpencodeModel(model, effort[model.id], thinkingFormatOverrides, defaultPackage);
		return projected === undefined ? [] : [projected];
	});
}
