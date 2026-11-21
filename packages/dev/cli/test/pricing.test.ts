import assert from "node:assert/strict";
import { test } from "node:test";

import { buildModels } from "@luthfisolahudin/ai-integrations-catalog";
import type { NormalizedModel, Pack } from "@luthfisolahudin/ai-integrations-contract";

import {
	buildPricingFragment,
	comparePricing,
	detectIndent,
	mergePricing,
	t3SettingsPath,
} from "../src/lib/pricing.ts";

const PACK = { id: "example", aliases: { "uncensored-model": "deepseek-v4.1-flash" } } as unknown as Pack;

function model(overrides: Partial<NormalizedModel> = {}): NormalizedModel {
	return {
		providerId: "example",
		id: "deepseek-v4.1-flash",
		name: "DeepSeek V4.1 Flash",
		contextWindow: 1_000_000,
		maxOutput: 393_216,
		input: ["text"],
		output: ["text"],
		reasoning: true,
		thinking: {},
		cost: { input: 0.3, output: 1.2, cacheRead: 0.006, cacheWrite: 0 },
		availability: "ok",
		provenance: {
			limits: { context: "catalog", maxOutput: "catalog" },
			modalities: "catalog",
			reasoning: "catalog",
			pricing: "models.dev",
			effort: "default",
		},
		...overrides,
	};
}

test("only priced, included models are emitted", () => {
	const fragment = buildPricingFragment(
		[
			model(),
			model({ id: "unpriced", cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, provenance: { ...model().provenance, pricing: "default" } }),
			model({ id: "hidden", excluded: { reason: "offline" } }),
		],
		[PACK],
	);
	assert.deepEqual(Object.keys(fragment.usagePriceOverrides), ["example/deepseek-v4.1-flash"]);
	assert.deepEqual(fragment.usagePriceOverrides["example/deepseek-v4.1-flash"], {
		inputCostPerMillionTokens: 0.3,
		outputCostPerMillionTokens: 1.2,
		cacheReadCostPerMillionTokens: 0.006,
	});
});

test("a zero cache-read price is omitted rather than written as free", () => {
	const fragment = buildPricingFragment(
		[model({ cost: { input: 1, output: 2, cacheRead: 0, cacheWrite: 0 } })],
		[PACK],
	);
	assert.equal(fragment.usagePriceOverrides["example/deepseek-v4.1-flash"]?.cacheReadCostPerMillionTokens, undefined);
});

test("an alias is emitted only for a model that exists", () => {
	const fragment = buildPricingFragment([model({ id: "uncensored-model" })], [PACK]);
	assert.equal(fragment.usageModelAliases["example/uncensored-model"], "deepseek-v4.1-flash");

	const absent = buildPricingFragment([model()], [PACK]);
	assert.deepEqual(absent.usageModelAliases, {});
});

test("merging preserves entries owned by other providers", () => {
	const settings = {
		usagePriceOverrides: {
			"commandcode/x": { inputCostPerMillionTokens: 1, outputCostPerMillionTokens: 2 },
			"example/old": { inputCostPerMillionTokens: 9, outputCostPerMillionTokens: 9 },
		},
		usageModelAliases: { "gutsai/y": "y" },
		unrelated: { keep: true },
	};
	const fragment = buildPricingFragment([model()], [PACK]);
	const merged = mergePricing(settings, fragment, { providerIds: ["example"] });

	assert.equal((merged.settings["usagePriceOverrides"] as Record<string, unknown>)["commandcode/x"] !== undefined, true);
	assert.equal((merged.settings["usageModelAliases"] as Record<string, unknown>)["gutsai/y"], "y");
	assert.deepEqual(merged.settings["unrelated"], { keep: true });
	assert.deepEqual(merged.added, ["example/deepseek-v4.1-flash"]);
	assert.equal(merged.untouched, 1);
});

test("without prune, a stale entry for this provider survives; with prune it goes", () => {
	const settings = { usagePriceOverrides: { "example/old": { inputCostPerMillionTokens: 9, outputCostPerMillionTokens: 9 } } };
	const fragment = buildPricingFragment([model()], [PACK]);

	const kept = mergePricing(settings, fragment, { providerIds: ["example"] });
	assert.equal((kept.settings["usagePriceOverrides"] as Record<string, unknown>)["example/old"] !== undefined, true);

	const pruned = mergePricing(settings, fragment, { providerIds: ["example"], prune: true });
	assert.equal((pruned.settings["usagePriceOverrides"] as Record<string, unknown>)["example/old"], undefined);
	assert.deepEqual(pruned.removed, ["example/old"]);
});

test("an unchanged price is neither added nor updated", () => {
	const settings = {
		usagePriceOverrides: {
			"example/deepseek-v4.1-flash": { inputCostPerMillionTokens: 0.3, outputCostPerMillionTokens: 1.2, cacheReadCostPerMillionTokens: 0.006 },
		},
	};
	const merged = mergePricing(settings, buildPricingFragment([model()], [PACK]), { providerIds: ["example"] });
	assert.deepEqual(merged.added, []);
	assert.deepEqual(merged.updated, []);
});

test("drift reports missing, different and stale separately", () => {
	const fragment = buildPricingFragment([model()], [PACK]);
	const drift = comparePricing(
		{
			usagePriceOverrides: {
				"example/deepseek-v4.1-flash": { inputCostPerMillionTokens: 9, outputCostPerMillionTokens: 9 },
				"example/removed": { inputCostPerMillionTokens: 1, outputCostPerMillionTokens: 1 },
			},
		},
		fragment,
		["example"],
	);
	assert.deepEqual(drift.different, ["example/deepseek-v4.1-flash"]);
	assert.deepEqual(drift.stale, ["example/removed"]);
	assert.deepEqual(drift.missing, []);
});

test("the settings path honours T3_SETTINGS_PATH", () => {
	assert.equal(t3SettingsPath({ T3_SETTINGS_PATH: "/tmp/t3.json" }, "/home/x"), "/tmp/t3.json");
	assert.equal(t3SettingsPath({}, "/home/x"), "/home/x/.t3/userdata/settings.json");
});

test("indentation is detected from the existing file", () => {
	assert.equal(detectIndent('{\n  "a": 1\n}'), "  ");
	assert.equal(detectIndent('{\n\t"a": 1\n}'), "\t");
});

test("exports an explicitly free catalog rate and skips incomplete rates", () => {
	const pack: Pack = {
		...PACK,
		hooks: { normalize: (record) => ({ cost: record.id === "free" ? { input: 0, output: 0, cacheRead: 0 } : { input: 3 } }) },
	};
	const models = buildModels(pack, [{ id: "free" }, { id: "partial" }]);
	const fragment = buildPricingFragment(models, [pack]);
	assert.deepEqual(fragment.usagePriceOverrides, {
		"example/free": { inputCostPerMillionTokens: 0, outputCostPerMillionTokens: 0, cacheReadCostPerMillionTokens: 0 },
	});
});
