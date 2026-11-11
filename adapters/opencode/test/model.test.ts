import assert from "node:assert/strict";
import { test } from "node:test";

import type { NormalizedModel } from "@luthfisolahudin/commandcode-integrations-contract";

import { effortLevels, toOpencodeModel, toOpencodeModels } from "../src/model.ts";

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
	assert.deepEqual(toOpencodeModel(model(), "max")?.capabilities.reasoning, { supported: true, effort: ["max"] });
	assert.deepEqual(toOpencodeModel(model())?.capabilities.reasoning, { supported: true });
});

test("an unmapped thinking format advertises no effort even when measured", () => {
	const projected = toOpencodeModel(model({ thinking: { format: "gemini-level", canDisable: true } }), "max");
	assert.deepEqual(projected?.capabilities.reasoning, { supported: true });
});

test("effort levels never include the off level", () => {
	assert.deepEqual(effortLevels("max", true), ["max"]);
	assert.equal(effortLevels(undefined, true), undefined);
});

test("a non-reasoning model has no reasoning capability block", () => {
	const projected = toOpencodeModel(model({ reasoning: false, thinking: {} }), "max");
	assert.equal(projected?.capabilities.reasoning, undefined);
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
	assert.deepEqual(projected?.capabilities.reasoning?.effort, ["low", "medium"]);
});

test("a none declaration is not advertised as an effort level", () => {
	const projected = toOpencodeModel(model({ thinking: { format: "qwen", canDisable: true, efforts: ["none", "high"] } }));
	assert.deepEqual(projected?.capabilities.reasoning?.effort, ["high"]);
});

test("a routed api selects the per-model host package", () => {
	assert.equal(toOpencodeModel(model({ api: "anthropic-messages" }))?.package, "@opencode/ai/providers/anthropic-compatible");
	assert.equal(toOpencodeModel(model({ api: "openai-responses" }))?.package, "@opencode/ai/providers/openai-compatible/responses");
	assert.equal(toOpencodeModel(model())?.package, undefined);
});
