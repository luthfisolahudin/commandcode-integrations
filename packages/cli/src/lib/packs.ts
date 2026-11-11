import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { buildModels, buildModelIndex, discover, type DiscoverOptions } from "@luthfisolahudin/commandcode-integrations-catalog";
import { capabilityView, inputModalities, type NormalizedModel, type Pack, type RawRecord } from "@luthfisolahudin/commandcode-integrations-contract";
import { MEASURED_WIRE_EFFORT, invariants, measuredIds, packs } from "@luthfisolahudin/commandcode-integrations-provider";

export interface LoadedPack {
	pack: Pack;
	fixture?: RawRecord[];
	models: NormalizedModel[];
	source: "fixture" | "network" | "fallback";
}

/** The vendor surface has exactly one fixture: this repo's provider payload. */
function fixturePath(root: string): string {
	return join(root, "packages", "provider", "fixtures", "catalog.json");
}

export function loadFixture(root: string, pack: Pack): RawRecord[] | undefined {
	const path = fixturePath(root);
	if (!existsSync(path)) return undefined;
	const payload = JSON.parse(readFileSync(path, "utf8")) as unknown;
	const body = payload as { data?: unknown; models?: unknown } | unknown[];
	const entries = Array.isArray(body) ? body : Array.isArray(body.data) ? body.data : Array.isArray(body.models) ? body.models : [];
	return entries.filter((entry): entry is RawRecord => typeof entry === "object" && entry !== null && !Array.isArray(entry) && typeof (entry as RawRecord).id === "string");
}

export function loadAll(
	root: string,
	options: { live?: boolean; modelsDev?: ReturnType<typeof buildModelIndex> } & DiscoverOptions = {},
): LoadedPack[] {
	const loaded: LoadedPack[] = [];
	const hint = options.modelsDev === undefined ? {} : { modelsDev: options.modelsDev };
	for (const pack of packs) {
		const fixture = loadFixture(root, pack);
		if (options.live === true) {
			// The caller awaits the network path separately.
			loaded.push({
				pack,
				...(fixture === undefined ? {} : { fixture }),
				models: buildModels(pack, fixture ?? [], { measuredIds, ...hint }),
				source: fixture === undefined ? "fallback" : "fixture",
			});
			continue;
		}
		loaded.push({
			pack,
			...(fixture === undefined ? {} : { fixture }),
			models: buildModels(pack, fixture ?? [], { measuredIds, ...hint }),
			source: fixture === undefined ? "fallback" : "fixture",
		});
	}
	return loaded;
}

export async function loadLivePack(
	pack: Pack,
	options: DiscoverOptions = {},
	modelsDev?: ReturnType<typeof buildModelIndex>,
): Promise<LoadedPack> {
	const result = await discover(pack, options);
	return {
		pack,
		fixture: result.raw,
		models: buildModels(pack, result.raw, { measuredIds, ...(modelsDev === undefined ? {} : { modelsDev }) }),
		source: "network",
	};
}

export interface InvariantFailure {
	model: string;
	key: string;
	expected: unknown;
	actual: unknown;
}

/** Compares curated ground truth against projected models, not raw payloads. */
export function checkInvariants(loaded: readonly LoadedPack[]): InvariantFailure[] {
	const failures: InvariantFailure[] = [];
	for (const entry of loaded) {
		const byId = new Map(entry.models.map((model) => [model.id, model]));
		for (const invariant of invariants) {
			const model = byId.get(invariant.id);
			if (model === undefined) continue;
			for (const [key, expected] of Object.entries(invariant.expected)) {
				const actual = invariantValue(model, key);
				if (actual !== expected) failures.push({ model: invariant.id, key, expected, actual });
			}
		}
	}
	return failures;
}

export function invariantValue(model: NormalizedModel, key: string): unknown {
	switch (key) {
		case "vision":
			return model.input.includes("image");
		case "pdf":
			return model.input.includes("pdf");
		case "videoInput":
			return model.input.includes("video");
		case "audioInput":
			return model.input.includes("audio");
		case "contextWindow":
			return model.contextWindow;
		case "maxOutput":
			return model.maxOutput;
		case "reasoning":
			return model.reasoning;
		case "tools":
			return model.tools;
		default:
			return (model as unknown as Record<string, unknown>)[key];
	}
}

/**
 * Reasoning models with no effort information at all: neither measured nor
 * declared by models.dev. They stay visible without a menu.
 */
export function unmeasured(models: readonly NormalizedModel[]): string[] {
	return models
		.filter((model) => model.reasoning && model.excluded === undefined && model.provenance.effort === "default")
		.map((model) => model.id);
}

/** Reasoning models whose menu comes from a models.dev declaration, not a probe. */
export function declaredOnly(models: readonly NormalizedModel[]): string[] {
	return models
		.filter((model) => model.reasoning && model.excluded === undefined && model.provenance.effort === "models.dev")
		.map((model) => model.id);
}

export function excluded(models: readonly NormalizedModel[]): { id: string; reason: string }[] {
	return models
		.filter((model) => model.excluded !== undefined)
		.map((model) => ({ id: model.id, reason: model.excluded?.reason ?? "unknown" }));
}

export function inventoryRows(models: readonly NormalizedModel[]): string[][] {
	return models
		.filter((model) => model.excluded === undefined)
		.sort((a, b) => a.id.localeCompare(b.id))
		.map((model) => [
			model.id,
			model.name,
			`${Math.round(model.contextWindow / 1000)}K`,
			`${Math.round(model.maxOutput / 1000)}K`,
			model.cost.input === 0 && model.cost.output === 0 ? "-" : `$${model.cost.input}/$${model.cost.output}`,
			model.input.join("+"),
			model.reasoning ? "yes" : "no",
			model.thinking.format ?? "-",
			MEASURED_WIRE_EFFORT[model.id] ?? "-",
			`${model.provenance.limits.context}/${model.provenance.limits.maxOutput}`,
			model.provenance.effort,
		]);
}

export const INVENTORY_HEADER = [
	"id",
	"name",
	"context",
	"max-out",
	"cost/1M",
	"input",
	"reasoning",
	"format",
	"wire-effort",
	"limits-src",
	"effort-src",
];

/** Reads a raw record's declared reasoning format, for the "unmapped" report. */
export function declaredFormat(pack: Pack, record: RawRecord): string | undefined {
	return capabilityView(record, pack.fields).thinkingFormat;
}

export { buildModelIndex, inputModalities };
