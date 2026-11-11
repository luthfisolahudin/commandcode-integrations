import type { NormalizedModel, Pack } from "@luthfisolahudin/commandcode-integrations-contract";

/** T3 Code's Settings → Usage shape, verified from `~/.t3/userdata/settings.json`. */
export interface T3Price {
	inputCostPerMillionTokens: number;
	outputCostPerMillionTokens: number;
	cacheReadCostPerMillionTokens?: number;
}

export interface T3PricingFragment {
	usagePriceOverrides: Record<string, T3Price>;
	usageModelAliases: Record<string, string>;
}

export interface FragmentOptions {
	/** Restrict to these provider ids. Defaults to the packs present in `models`. */
	providerIds?: readonly string[];
}

function priceKey(providerId: string, modelId: string): string {
	return `${providerId}/${modelId}`;
}

/**
 * Builds the T3 Code block for the models this repo ships.
 *
 * Only priced models are emitted: a zero is not a price, and writing one would
 * tell T3 that the model is free. Aliases become `usageModelAliases` so usage
 * from a renamed or coupled model aggregates into one row, but only for models
 * that actually exist in the catalog — an alias never invents membership.
 */
export function buildPricingFragment(
	models: readonly NormalizedModel[],
	packs: readonly Pack[],
	options: FragmentOptions = {},
): T3PricingFragment {
	const allowed = new Set(options.providerIds ?? packs.map((pack) => pack.id));
	const aliases = new Map<string, string>();
	for (const pack of packs) {
		for (const [modelId, target] of Object.entries(pack.aliases ?? {})) {
			aliases.set(priceKey(pack.id, modelId), target);
		}
	}

	const fragment: T3PricingFragment = { usagePriceOverrides: {}, usageModelAliases: {} };
	for (const model of models) {
		if (!allowed.has(model.providerId)) continue;
		if (model.excluded !== undefined) continue;
		const key = priceKey(model.providerId, model.id);

		if (model.provenance.pricing !== "default" && (model.cost.input > 0 || model.cost.output > 0)) {
			fragment.usagePriceOverrides[key] = {
				inputCostPerMillionTokens: model.cost.input,
				outputCostPerMillionTokens: model.cost.output,
				...(model.cost.cacheRead > 0 ? { cacheReadCostPerMillionTokens: model.cost.cacheRead } : {}),
			};
		}

		const alias = aliases.get(key);
		if (alias !== undefined) fragment.usageModelAliases[key] = alias;
	}
	return fragment;
}

export interface MergeOptions {
	providerIds: readonly string[];
	/** Drop entries for this provider that the fragment no longer contains. */
	prune?: boolean;
}

export interface MergeResult {
	settings: Record<string, unknown>;
	added: string[];
	updated: string[];
	removed: string[];
	/** Keys owned by another provider were never touched. */
	untouched: number;
}

function ownsKey(key: string, providerIds: readonly string[]): boolean {
	return providerIds.some((id) => key.startsWith(`${id}/`));
}

/**
 * Merges the fragment into a T3 Code settings object.
 *
 * Ownership is the whole safety story: only keys that start with one of this
 * repo's provider ids are read or written, so running the command from two
 * provider repos never fights over the same file. Everything else is preserved
 * verbatim, including key order.
 */
export function mergePricing(
	settings: Record<string, unknown>,
	fragment: T3PricingFragment,
	options: MergeOptions,
): MergeResult {
	const result: MergeResult = { settings: { ...settings }, added: [], updated: [], removed: [], untouched: 0 };

	const overrides = { ...((settings["usagePriceOverrides"] as Record<string, T3Price> | undefined) ?? {}) };
	for (const [key, value] of Object.entries(fragment.usagePriceOverrides)) {
		const previous = overrides[key];
		if (previous === undefined) result.added.push(key);
		else if (JSON.stringify(previous) !== JSON.stringify(value)) result.updated.push(key);
		overrides[key] = value;
	}
	const aliases = { ...((settings["usageModelAliases"] as Record<string, string> | undefined) ?? {}) };
	for (const [key, value] of Object.entries(fragment.usageModelAliases)) {
		const previous = aliases[key];
		if (previous === undefined) result.added.push(`alias ${key}`);
		else if (previous !== value) result.updated.push(`alias ${key}`);
		aliases[key] = value;
	}

	if (options.prune === true) {
		for (const key of Object.keys(overrides)) {
			if (!ownsKey(key, options.providerIds)) continue;
			if (fragment.usagePriceOverrides[key] !== undefined) continue;
			delete overrides[key];
			result.removed.push(key);
		}
		for (const key of Object.keys(aliases)) {
			if (!ownsKey(key, options.providerIds)) continue;
			if (fragment.usageModelAliases[key] !== undefined) continue;
			delete aliases[key];
			result.removed.push(`alias ${key}`);
		}
	}

	result.untouched = Object.keys(overrides).filter((key) => !ownsKey(key, options.providerIds)).length;
	result.settings["usagePriceOverrides"] = overrides;
	result.settings["usageModelAliases"] = aliases;
	return result;
}

export interface Drift {
	missing: string[];
	different: string[];
	stale: string[];
}

/** Compares what T3 has against what this repo would write. */
export function comparePricing(
	settings: Record<string, unknown>,
	fragment: T3PricingFragment,
	providerIds: readonly string[],
): Drift {
	const drift: Drift = { missing: [], different: [], stale: [] };
	const overrides = (settings["usagePriceOverrides"] as Record<string, T3Price> | undefined) ?? {};
	const aliases = (settings["usageModelAliases"] as Record<string, string> | undefined) ?? {};

	for (const [key, value] of Object.entries(fragment.usagePriceOverrides)) {
		const previous = overrides[key];
		if (previous === undefined) drift.missing.push(key);
		else if (JSON.stringify(previous) !== JSON.stringify(value)) drift.different.push(key);
	}
	for (const [key, value] of Object.entries(fragment.usageModelAliases)) {
		const previous = aliases[key];
		if (previous === undefined) drift.missing.push(`alias ${key}`);
		else if (previous !== value) drift.different.push(`alias ${key}`);
	}
	for (const key of Object.keys(overrides)) {
		if (ownsKey(key, providerIds) && fragment.usagePriceOverrides[key] === undefined) drift.stale.push(key);
	}
	for (const key of Object.keys(aliases)) {
		if (ownsKey(key, providerIds) && fragment.usageModelAliases[key] === undefined) drift.stale.push(`alias ${key}`);
	}
	return drift;
}

/** T3 Code's settings path, overridable for tests and non-standard installs. */
export function t3SettingsPath(env: NodeJS.ProcessEnv = process.env, home: string): string {
	const explicit = env["T3_SETTINGS_PATH"];
	if (explicit !== undefined && explicit.trim().length > 0) return explicit.trim();
	return `${home}/.t3/userdata/settings.json`;
}

/** Detects the indentation the file already uses so a rewrite does not reflow it. */
export function detectIndent(source: string): string {
	const match = /\n(\s+)"/.exec(source);
	return match?.[1] ?? "  ";
}
