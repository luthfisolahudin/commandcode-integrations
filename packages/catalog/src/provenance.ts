import {
	capabilityView,
	displayName,
	inputModalities,
	outputModalities,
	resolveLimit,
	type Availability,
	type ModelCost,
	type ModelFacts,
	type NormalizedModel,
	type Pack,
	type RawRecord,
	type Source,
} from "@luthfisolahudin/commandcode-integrations-contract";

import { exclusionReason } from "./availability.ts";
import type { ModelIndex } from "./modelsdev.ts";

export interface BuildOptions {
	modelsDev?: ModelIndex;
	/** Ids with a measured wire effort; drives `provenance.effort`. */
	measuredIds?: ReadonlySet<string>;
}

const DEFAULT_CONTEXT = 128_000;
const DEFAULT_MAX_OUTPUT = 16_384;
const ZERO_COST: ModelCost = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };

function firstDefined<T>(...values: (T | undefined)[]): T | undefined {
	for (const value of values) {
		if (value !== undefined) return value;
	}
	return undefined;
}

function hasDeclared(record: RawRecord, paths: readonly string[] | undefined): boolean {
	for (const path of paths ?? []) {
		let current: unknown = record;
		for (const segment of path.split(".")) {
			if (typeof current !== "object" || current === null || Array.isArray(current)) {
				current = undefined;
				break;
			}
			current = (current as Record<string, unknown>)[segment];
		}
		if (current !== undefined) return true;
	}
	return false;
}

interface MergedFacts {
	catalog: ModelFacts;
	curated: Partial<ModelFacts>;
	effective: ModelFacts;
	/** What the provider actually said, so models.dev only fills silence. */
	declared: { limits: boolean; modalities: boolean; reasoning: boolean; tools: boolean };
}

/**
 * Keeps catalog facts and curated facts apart instead of merging them on the
 * spot, because the limit ladder has to know which one it hit. Merging early is
 * how a curated value silently starts reporting itself as `catalog`.
 */
function mergeFacts(pack: Pack, record: RawRecord): MergedFacts | undefined {
	const view = capabilityView(record, pack.fields);
	const id = String(record.id);
	const curated = pack.curated?.[id] ?? {};
	const hooked = pack.hooks?.normalize?.(record);
	if (pack.hooks?.normalize !== undefined && hooked === undefined) return undefined;

	const catalog: ModelFacts = {
		input: inputModalities(view),
		output: outputModalities(view),
		reasoning: view.reasoning,
		availability: (view.availability ?? "unknown") as Availability,
		...(view.name === undefined ? {} : { name: view.name }),
		...(view.contextWindow === undefined ? {} : { contextWindow: view.contextWindow }),
		...(view.maxOutput === undefined ? {} : { maxOutput: view.maxOutput }),
		...(view.tools === undefined ? {} : { tools: view.tools }),
		...(view.thinkingFormat === undefined ? {} : { thinkingFormat: view.thinkingFormat }),
		...(view.thinkingCanDisable === undefined ? {} : { thinkingCanDisable: view.thinkingCanDisable }),
		...(view.declaredEfforts === undefined ? {} : { efforts: view.declaredEfforts }),
		...(hooked ?? {}),
		id,
	};

	const effective: ModelFacts = {
		id,
		name: firstDefined(curated.name, catalog.name),
		contextWindow: firstDefined(catalog.contextWindow, curated.contextWindow),
		maxOutput: firstDefined(catalog.maxOutput, curated.maxOutput),
		input: firstDefined(curated.input, catalog.input),
		output: firstDefined(curated.output, catalog.output),
		tools: firstDefined(catalog.tools, curated.tools),
		reasoning: catalog.reasoning === true || curated.reasoning === true,
		thinkingFormat: firstDefined(catalog.thinkingFormat, curated.thinkingFormat),
		thinkingCanDisable: firstDefined(catalog.thinkingCanDisable, curated.thinkingCanDisable),
		efforts: firstDefined(curated.efforts, catalog.efforts),
		api: firstDefined(catalog.api, curated.api),
		availability: firstDefined(catalog.availability, curated.availability) ?? "unknown",
	};
	for (const key of ["name", "contextWindow", "maxOutput", "tools", "thinkingFormat", "thinkingCanDisable", "api", "efforts"] as const) {
		if (effective[key] === undefined) delete effective[key];
	}

	const declared = {
		limits: hasDeclared(record, pack.fields?.contextWindow) || hasDeclared(record, pack.fields?.maxOutput) ||
			curated.contextWindow !== undefined || curated.maxOutput !== undefined,
		modalities: hasDeclared(record, pack.fields?.vision) || hasDeclared(record, pack.fields?.pdf) ||
			hasDeclared(record, pack.fields?.audioInput) || hasDeclared(record, pack.fields?.videoInput) ||
			hasDeclared(record, pack.fields?.inputModalities) || curated.input !== undefined ||
			curated.output !== undefined,
		reasoning: hasDeclared(record, pack.fields?.reasoning) || curated.reasoning !== undefined,
		tools: hasDeclared(record, pack.fields?.tools) || curated.tools !== undefined,
	};

	return { catalog, curated, effective, declared };
}

export function buildModel(pack: Pack, merged: MergedFacts, options: BuildOptions = {}): NormalizedModel {
	const { catalog, curated, effective, declared } = merged;
	// An alias only redirects the lookup; membership still comes from the catalog.
	const lookupKey = pack.aliases?.[effective.id] ?? effective.id;
	const hint = options.modelsDev?.get(lookupKey);

	const context = resolveLimit({
		catalog: catalog.contextWindow,
		curated: curated.contextWindow,
		modelsDev: declared.limits ? undefined : hint?.contextWindow,
		defaultValue: pack.defaults?.contextWindow ?? DEFAULT_CONTEXT,
	});
	const maxOutput = resolveLimit({
		catalog: catalog.maxOutput,
		curated: curated.maxOutput,
		modelsDev: declared.limits ? undefined : hint?.maxOutput,
		defaultValue: pack.defaults?.maxOutput ?? DEFAULT_MAX_OUTPUT,
		capBy: context.value,
	});

	// models.dev fills only what the provider left unsaid.
	const hintedImage = declared.modalities ? undefined : hint?.image;
	const input = [...(effective.input ?? ["text"])];
	let modalitiesSource: Source = curated.input !== undefined || curated.output !== undefined ? "curated" : "catalog";
	if (hintedImage === true && !input.includes("image")) {
		input.push("image");
		modalitiesSource = "models.dev";
	}

	const reasoningDeclared = declared.reasoning;
	const reasoning = reasoningDeclared ? effective.reasoning === true : (hint?.reasoning ?? effective.reasoning === true);
	const tools = declared.tools ? effective.tools : firstDefined(effective.tools, hint?.tools);

	// Curated price > models.dev > zero. A price the provider declares is never used.
	// A measured wire value always wins. Otherwise the levels the provider declares
	// (via models.dev) are used, and recorded as a declaration, not a measurement.
	const measured = options.measuredIds?.has(effective.id) === true;
	// A declared enum can come from the provider's own catalog (the strongest
	// declaration) or from models.dev.
	const catalogEfforts = effective.efforts;
	const declaredEfforts = measured
		? undefined
		: (catalogEfforts ?? hint?.efforts);
	const canDisable =
		effective.thinkingCanDisable ??
		(declaredEfforts === undefined || hint?.toggle !== true ? undefined : true);

	const costSource: Source = curated.cost !== undefined ? "curated" : hint?.cost === undefined ? "default" : "models.dev";
	const cost: ModelCost = {
		input: curated.cost?.input ?? hint?.cost?.input ?? ZERO_COST.input,
		output: curated.cost?.output ?? hint?.cost?.output ?? ZERO_COST.output,
		cacheRead: curated.cost?.cacheRead ?? hint?.cost?.cacheRead ?? ZERO_COST.cacheRead,
		cacheWrite: curated.cost?.cacheWrite ?? hint?.cost?.cacheWrite ?? ZERO_COST.cacheWrite,
	};

	const routedApi = effective.api !== undefined && effective.api.length > 0 ? effective.api : pack.hooks?.route?.(effective);
	const model: NormalizedModel = {
		providerId: pack.id,
		id: effective.id,
		name: effective.name ?? displayName(effective.id, { brands: pack.brands, owners: pack.owners, names: pack.names }),
		contextWindow: context.value,
		maxOutput: maxOutput.value,
		input,
		output: effective.output ?? ["text"],
		reasoning,
		thinking: {
			...(effective.thinkingFormat === undefined ? {} : { format: effective.thinkingFormat }),
			...(canDisable === undefined ? {} : { canDisable }),
			...(declaredEfforts === undefined ? {} : { efforts: declaredEfforts }),
		},
		cost,
		availability: effective.availability ?? "unknown",
		provenance: {
			limits: { context: context.source, maxOutput: maxOutput.source },
			modalities: modalitiesSource,
			reasoning: reasoningDeclared ? (curated.reasoning === true ? "curated" : "catalog") : hint?.reasoning === undefined ? "default" : "models.dev",
			pricing: costSource,
			effort: measured
				? "measured"
				: declaredEfforts === undefined
					? "default"
					: catalogEfforts !== undefined
						? "catalog"
						: "models.dev",
		},
	};
	if (tools !== undefined) model.tools = tools;
	if (routedApi !== undefined) model.api = routedApi;

	const excluded = exclusionReason({ pack, modelId: model.id, availability: model.availability });
	if (excluded !== undefined) model.excluded = { reason: excluded };

	return pack.hooks?.decorate?.(model) ?? model;
}

function pinnedModel(pack: Pack, id: string): MergedFacts {
	const facts: ModelFacts = { id, input: ["text"], output: ["text"], reasoning: false, availability: "unknown" };
	return {
		catalog: facts,
		curated: {},
		effective: facts,
		declared: { limits: false, modalities: false, reasoning: false, tools: false },
	};
}

/**
 * Builds the full list: discovered records, then any pinned fallback member the
 * catalog did not return. Excluded records stay in the list with a reason so
 * reporting can explain every disappearance.
 */
export function buildModels(pack: Pack, records: readonly RawRecord[], options: BuildOptions = {}): NormalizedModel[] {
	const models: NormalizedModel[] = [];
	const seen = new Set<string>();

	for (const record of records) {
		const merged = mergeFacts(pack, record);
		if (merged === undefined) continue;
		seen.add(merged.effective.id);
		models.push(buildModel(pack, merged, options));
	}

	for (const pinned of pack.fallback ?? []) {
		if (seen.has(pinned.id)) continue;
		const model = buildModel(pack, pinnedModel(pack, pinned.id), options);
		// A pinned fallback exists so the provider is never empty offline.
		delete model.excluded;
		models.push(model);
	}

	return models.sort((a, b) => a.id.localeCompare(b.id));
}
