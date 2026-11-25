import assert from "node:assert/strict";
import { test } from "node:test";

import type { NormalizedModel } from "@luthfisolahudin/ai-integrations-contract";

import { toOpencodeModel, toOpencodeModels, providerSettings } from "../src/model.ts";

function model(overrides: Partial<NormalizedModel> = {}): NormalizedModel {
	return {
		providerId: "example",
		id: "model-1",
		name: "Model 1",
		contextWindow: 1_000_000,
		maxOutput: 131_072,
		input: ["text", "image", "pdf"],
		output: ["text"],
		tools: true,
		reasoning: true,
		thinking: { format: "qwen", canDisable: true },
		cost: { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 0 },
		availability: "ok",
		provenance: {
			limits: { context: "catalog", maxOutput: "catalog" },
			modalities: "catalog",
			reasoning: "catalog",
			pricing: "default",
			effort: "default",
		},
		...overrides,
	};
}

test("capabilities and limits pass through", () => {
	const projected = toOpencodeModel(model());
	assert.ok(projected);
	assert.equal(projected.limit.context, 1_000_000);
	assert.equal(projected.limit.output, 131_072);
	assert.deepEqual(projected.capabilities.input, ["text", "image", "pdf"]);
	assert.equal(projected.capabilities.tools, true);
});

test("excluded models are not registered", () => {
	assert.equal(toOpencodeModel(model({ excluded: { reason: "non-chat" } })), undefined);
});

test("a measured effort is advertised; an unmeasured one is not", () => {
	assert.deepEqual(toOpencodeModel(model(), "max")?.variants, [{ id: "max", settings: { reasoningEffort: "max" } }]);
	assert.deepEqual(toOpencodeModel(model())?.variants, []);
});

test("an unmapped thinking format advertises no effort even when measured", () => {
	const projected = toOpencodeModel(model({ thinking: { format: "gemini-level", canDisable: true } }), "max");
	assert.deepEqual(projected?.variants, []);
});

test("a non-reasoning model has no effort variants", () => {
	const projected = toOpencodeModel(model({ reasoning: false, thinking: {} }), "max");
	assert.deepEqual(projected?.variants, []);
});

test("the list projection drops exclusions", () => {
	const projected = toOpencodeModels(
		[model({ id: "a" }), model({ id: "b", excluded: { reason: "offline" } })],
		{ a: "max" },
	);
	assert.deepEqual(projected.map((entry) => entry.id), ["a"]);
});

test("declared levels are advertised when nothing was measured", () => {
	const projected = toOpencodeModel(model({ thinking: { format: "qwen", canDisable: true, efforts: ["low", "medium"] } }));
	assert.deepEqual(projected?.variants.map((variant) => variant.id), ["low", "medium"]);
});

test("an explicit off value becomes its own variant", () => {
	const projected = toOpencodeModel(model({ thinking: { format: "qwen", canDisable: true, efforts: ["none", "high"] } }));
	assert.deepEqual(projected?.variants.map((variant) => variant.id), ["none", "high"]);
});

test("a routed api selects the per-model host package", () => {
	assert.equal(toOpencodeModel(model({ api: "anthropic-messages" }))?.package, "@opencode/ai/providers/anthropic-compatible");
	assert.equal(toOpencodeModel(model({ api: "openai-responses" }))?.package, "@opencode/ai/providers/openai-compatible/responses");
	assert.equal(toOpencodeModel(model())?.package, undefined);
});

test("provider settings carry the key when one resolves", () => {
	assert.deepEqual(providerSettings("https://example.test/v1", "sk-key"), {
		baseURL: "https://example.test/v1",
		apiKey: "sk-key",
	});
});

test("a keyless provider omits apiKey instead of carrying undefined", () => {
	const settings = providerSettings("https://example.test/v1", undefined);
	// OpenCode encodes provider snapshots as JSON; an undefined value throws
	// SchemaError and invalidates every provider, not just this one.
	assert.deepEqual(settings, { baseURL: "https://example.test/v1" });
	assert.equal(Object.hasOwn(settings, "apiKey"), false);
	assert.equal(JSON.stringify({ settings }).includes("undefined"), false);
});
