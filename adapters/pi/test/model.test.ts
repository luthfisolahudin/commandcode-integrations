import assert from "node:assert/strict";
import { test } from "node:test";

import type { NormalizedModel } from "@luthfisolahudin/commandcode-integrations-contract";

import { toPiModel, toPiModels } from "../src/model.ts";

const HOST = { providerId: "example", baseUrl: "https://api.example.test/v1" };

function model(overrides: Partial<NormalizedModel> = {}): NormalizedModel {
	return {
		providerId: "example",
		id: "model-1",
		name: "Model 1",
		contextWindow: 200_000,
		maxOutput: 8_192,
		input: ["text", "image"],
		output: ["text"],
		tools: true,
		reasoning: true,
		thinking: { format: "openai", canDisable: true },
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

test("the projection is a complete Pi chat model", () => {
	const projected = toPiModel(model(), HOST);
	assert.ok(projected);
	assert.equal(projected.type, "chat");
	assert.equal(projected.provider, "example");
	assert.equal(projected.api, "openai-completions");
	assert.equal(projected.baseUrl, "https://api.example.test/v1");
	assert.equal(projected.contextWindow, 200_000);
	assert.equal(projected.maxTokens, 8_192);
});

test("excluded models are not registered", () => {
	assert.equal(toPiModel(model({ excluded: { reason: "offline" } }), HOST), undefined);
});

test("only text and image survive as Pi input modalities", () => {
	const projected = toPiModel(model({ input: ["text", "pdf", "audio", "image", "video"] }), HOST);
	assert.deepEqual(projected?.input, ["text", "image"]);
});

test("a measured effort produces a menu with the mapped thinking format", () => {
	const projected = toPiModel(model(), { ...HOST, wireEffort: "xhigh" });
	assert.equal(projected?.compat?.thinkingFormat, "openai");
	assert.equal(projected?.compat?.supportsReasoningEffort, true);
	assert.equal(projected?.thinkingLevelMap?.max, "xhigh");
});

test("no measured effort means no menu, even with a mapped format", () => {
	const projected = toPiModel(model(), HOST);
	assert.equal(projected?.compat?.thinkingFormat, "openai");
	assert.equal(projected?.thinkingLevelMap, undefined);
	assert.equal(projected?.compat?.supportsReasoningEffort, undefined);
});

test("an unmapped thinking format claims nothing", () => {
	const projected = toPiModel(model({ thinking: { format: "kimi", canDisable: false } }), { ...HOST, wireEffort: "max" });
	assert.equal(projected?.compat?.thinkingFormat, undefined);
	assert.equal(projected?.thinkingLevelMap, undefined);
	assert.equal(projected?.reasoning, true);
});

test("a non-disableable model hides the off level", () => {
	const projected = toPiModel(model({ thinking: { format: "openai", canDisable: false } }), { ...HOST, wireEffort: "max" });
	assert.equal(projected?.thinkingLevelMap?.off, null);
	assert.equal(projected?.thinkingLevelMap?.max, "max");
});

test("a non-reasoning model carries no thinking fields at all", () => {
	const projected = toPiModel(model({ reasoning: false, thinking: {} }), { ...HOST, wireEffort: "max" });
	assert.equal(projected?.reasoning, false);
	assert.equal(projected?.thinkingLevelMap, undefined);
	assert.equal(projected?.compat, undefined);
});

test("host compat defaults are merged rather than replaced", () => {
	const projected = toPiModel(model(), { ...HOST, compat: { maxTokensField: "max_tokens" }, wireEffort: "max" });
	assert.equal(projected?.compat?.maxTokensField, "max_tokens");
	assert.equal(projected?.compat?.thinkingFormat, "openai");
});

test("the list projection drops excluded entries and keeps order", () => {
	const projected = toPiModels(
		[model({ id: "a" }), model({ id: "b", excluded: { reason: "offline" } }), model({ id: "c", reasoning: false, thinking: {} })],
		{ a: "max" },
		HOST,
	);
	assert.deepEqual(projected.map((entry) => entry.id), ["a", "c"]);
	assert.equal(projected[0]?.thinkingLevelMap?.max, "max");
});

test("declared levels provide a menu when nothing was measured", () => {
	const projected = toPiModel(model({ thinking: { format: "openai", canDisable: true, efforts: ["low", "high"] } }), HOST);
	assert.equal(projected?.thinkingLevelMap?.low, "low");
	assert.equal(projected?.thinkingLevelMap?.high, "high");
	assert.equal(projected?.thinkingLevelMap?.max, null);
	// The flag says the parameter is accepted, not that the route honours it. The
	// difference between a declared and a measured menu lives in provenance.
	assert.equal(projected?.compat?.supportsReasoningEffort, true);
});

test("a measured value still wins over a declaration", () => {
	const projected = toPiModel(
		model({ thinking: { format: "openai", canDisable: true, efforts: ["low", "high"] } }),
		{ ...HOST, wireEffort: "xhigh" },
	);
	assert.equal(projected?.thinkingLevelMap?.max, "xhigh");
	assert.equal(projected?.thinkingLevelMap?.low, null);
	assert.equal(projected?.compat?.supportsReasoningEffort, true);
});

test("declared levels on an unmapped format are not advertised", () => {
	const projected = toPiModel(model({ thinking: { format: "kimi", canDisable: true, efforts: ["low", "high"] } }), HOST);
	assert.equal(projected?.thinkingLevelMap, undefined);
});

test("a pack's measured format override unlocks a declared menu", () => {
	const projected = toPiModel(
		model({ thinking: { format: "gemini-budget", canDisable: true, efforts: ["low", "high"] } }),
		{ ...HOST, thinkingFormatOverrides: { "gemini-budget": "openai" } },
	);
	assert.equal(projected?.compat?.thinkingFormat, "openai");
	assert.equal(projected?.thinkingLevelMap?.high, "high");
});

test("without the override the same model stays closed", () => {
	const projected = toPiModel(model({ thinking: { format: "gemini-budget", canDisable: true, efforts: ["low", "high"] } }), HOST);
	assert.equal(projected?.thinkingLevelMap, undefined);
});

test("a routed model api overrides the host default", () => {
	const projected = toPiModel(model({ api: "anthropic-messages" }), HOST);
	assert.equal(projected?.api, "anthropic-messages");
	assert.equal(toPiModel(model(), HOST)?.api, "openai-completions");
});
