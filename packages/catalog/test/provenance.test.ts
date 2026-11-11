import assert from "node:assert/strict";
import { test } from "node:test";

import { PACK_SCHEMA_VERSION, definePack, type Pack } from "@luthfisolahudin/commandcode-integrations-contract";

import { buildModelIndex, buildModels, exclusionReason } from "../src/index.ts";

function tierA(): Pack {
	return definePack({
		schemaVersion: PACK_SCHEMA_VERSION,
		id: "example",
		name: "Example",
		baseUrl: "https://api.example.test/v1",
		discovery: { path: "/models" },
		fields: {
			contextWindow: ["capabilities.contextWindow"],
			maxOutput: ["capabilities.maxOutput"],
			vision: ["capabilities.vision"],
			tools: ["capabilities.tools"],
			reasoning: ["capabilities.reasoning"],
			thinkingFormat: ["capabilities.thinkingFormat"],
			thinkingCanDisable: ["capabilities.thinkingCanDisable"],
		},
		defaults: { contextWindow: 128_000, maxOutput: 16_384 },
		fallback: [{ id: "pinned-offline" }],
	});
}

const RECORDS = [
	{
		id: "chat-vision",
		capabilities: {
			vision: true,
			tools: true,
			reasoning: true,
			thinkingFormat: "kimi",
			thinkingCanDisable: false,
			contextWindow: 1_000_000,
			maxOutput: 131_072,
		},
	},
	{ id: "chat-plain" },
];

test("facts come from the catalog and are reported as such", () => {
	const [model] = buildModels(tierA(), RECORDS).filter((entry) => entry.id === "chat-vision");
	assert.ok(model);
	assert.equal(model.contextWindow, 1_000_000);
	assert.equal(model.maxOutput, 131_072);
	assert.deepEqual(model.input, ["text", "image"]);
	assert.equal(model.reasoning, true);
	assert.equal(model.thinking.format, "kimi");
	assert.equal(model.thinking.canDisable, false);
	assert.deepEqual(model.provenance.limits, { context: "catalog", maxOutput: "catalog" });
	assert.equal(model.provenance.effort, "default");
});

test("a silent catalog falls back to defaults and records that", () => {
	const [model] = buildModels(tierA(), RECORDS).filter((entry) => entry.id === "chat-plain");
	assert.ok(model);
	assert.equal(model.contextWindow, 128_000);
	assert.deepEqual(model.provenance.limits, { context: "default", maxOutput: "default" });
	assert.deepEqual(model.input, ["text"]);
});

test("curated facts fill what the catalog cannot express", () => {
	const pack = definePack({
		...tierA(),
		curated: { "chat-plain": { contextWindow: 262_144, name: "Curated Name" } },
	});
	const [model] = buildModels(pack, RECORDS).filter((entry) => entry.id === "chat-plain");
	assert.equal(model?.contextWindow, 262_144);
	assert.deepEqual(model?.provenance.limits, { context: "curated", maxOutput: "default" });
	assert.equal(model?.name, "Curated Name");
});

test("models.dev only fills a gap, never overrides the catalog", () => {
	const index = buildModelIndex({
		p: { models: { "chat-vision": { limit: { context: 8_192, output: 1_024 } } } },
	});
	const [model] = buildModels(tierA(), RECORDS, { modelsDev: index }).filter((e) => e.id === "chat-vision");
	assert.equal(model?.contextWindow, 1_000_000);
	assert.deepEqual(model?.provenance.limits, { context: "catalog", maxOutput: "catalog" });
});

test("models.dev supplies modalities when the pack declares none", () => {
	const index = buildModelIndex({ p: { models: { "chat-plain": { attachment: true, reasoning: true, tool_call: true } } } });
	const [model] = buildModels(tierA(), RECORDS, { modelsDev: index }).filter((e) => e.id === "chat-plain");
	assert.deepEqual(model?.input, ["text", "image"]);
	assert.equal(model?.reasoning, true);
	assert.equal(model?.tools, true);
	assert.equal(model?.provenance.modalities, "models.dev");
	assert.equal(model?.provenance.reasoning, "models.dev");
});

test("models.dev never overrides a declared capability", () => {
	const index = buildModelIndex({ p: { models: { "chat-vision": { attachment: false, reasoning: false } } } });
	const [model] = buildModels(tierA(), RECORDS, { modelsDev: index }).filter((e) => e.id === "chat-vision");
	assert.deepEqual(model?.input, ["text", "image"]);
	assert.equal(model?.reasoning, true);
	assert.equal(model?.provenance.modalities, "catalog");
});

test("USD cost comes from models.dev and stays zero when absent", () => {
	const index = buildModelIndex({ p: { models: { "chat-vision": { cost: { input: 3, output: 15, cache_read: 0.3 } } } } });
	const priced = buildModels(tierA(), RECORDS, { modelsDev: index }).find((e) => e.id === "chat-vision");
	assert.deepEqual(priced?.cost, { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 0 });
	assert.equal(priced?.provenance.pricing, "models.dev");

	const unpriced = buildModels(tierA(), RECORDS).find((e) => e.id === "chat-vision");
	assert.deepEqual(unpriced?.cost, { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 });
	assert.equal(unpriced?.provenance.pricing, "default");
});

test("models.dev supplies a limit when nothing else does", () => {
	const index = buildModelIndex({ p: { models: { "chat-plain": { limit: { context: 200_000, output: 8_000 } } } } });
	const [model] = buildModels(tierA(), RECORDS, { modelsDev: index }).filter((e) => e.id === "chat-plain");
	assert.equal(model?.contextWindow, 200_000);
	assert.deepEqual(model?.provenance.limits, { context: "models.dev", maxOutput: "models.dev" });
});

test("output never exceeds the context window", () => {
	const pack = definePack({ ...tierA(), curated: { "chat-plain": { contextWindow: 4_096, maxOutput: 65_536 } } });
	const [model] = buildModels(pack, RECORDS).filter((e) => e.id === "chat-plain");
	assert.equal(model?.maxOutput, 4_096);
});

test("a pinned fallback member is present even when discovery omits it", () => {
	const models = buildModels(tierA(), RECORDS);
	const pinned = models.find((entry) => entry.id === "pinned-offline");
	assert.ok(pinned);
	assert.equal(pinned.excluded, undefined);
});

test("offline models are excluded with a reason, and kept in the list", () => {
	const pack = definePack({
		...tierA(),
		fields: { ...tierA().fields, availability: ["status"] },
	});
	const models = buildModels(pack, [{ id: "down", status: "offline" }]);
	const model = models.find((entry) => entry.id === "down");
	assert.equal(model?.excluded?.reason, "offline");
});

test("unknown availability is not excluded by default", () => {
	const models = buildModels(tierA(), RECORDS);
	assert.equal(models.find((entry) => entry.id === "chat-plain")?.excluded, undefined);
});

test("exclusion reasons are individually addressable", () => {
	const pack = tierA();
	assert.equal(exclusionReason({ pack, modelId: "a", availability: "ok" }), undefined);
	assert.equal(
		exclusionReason({ pack: definePack({ ...pack, filter: { excludeIds: ["a"] } }), modelId: "a", availability: "ok" }),
		"excluded-id",
	);
	assert.equal(
		exclusionReason({ pack: definePack({ ...pack, filter: { nonChatPattern: "embed" } }), modelId: "q-embed", availability: "ok" }),
		"non-chat",
	);
	assert.equal(
		exclusionReason({ pack: definePack({ ...pack, filter: { dropOffline: false } }), modelId: "a", availability: "offline" }),
		undefined,
	);
});

test("measured ids drive provenance.effort", () => {
	const [model] = buildModels(tierA(), RECORDS, { measuredIds: new Set(["chat-vision"]) }).filter(
		(entry) => entry.id === "chat-vision",
	);
	assert.equal(model?.provenance.effort, "measured");
});

test("the decorate hook can rename without inventing membership", () => {
	const pack = definePack({
		...tierA(),
		hooks: { decorate: (model) => ({ ...model, name: `X ${model.name}` }) },
	});
	const models = buildModels(pack, RECORDS);
	assert.ok(models.every((model) => model.name.startsWith("X ")));
	assert.deepEqual(models.map((model) => model.id), ["chat-plain", "chat-vision", "pinned-offline"]);
});

test("an alias redirects the metadata lookup without adding membership", () => {
	const index = buildModelIndex({
		p: {
			models: {
				"kimi-k3": {
					limit: { context: 1_048_576, output: 131_072 },
					attachment: true,
					reasoning: true,
					cost: { input: 3, output: 15 },
				},
			},
		},
	});
	const pack = definePack({ ...tierA(), aliases: { "chat-plain": "kimi-k3" } });
	const models = buildModels(pack, RECORDS, { modelsDev: index });
	const aliased = models.find((entry) => entry.id === "chat-plain");
	assert.equal(aliased?.contextWindow, 1_048_576);
	assert.equal(aliased?.cost.input, 3);
	assert.deepEqual(aliased?.input, ["text", "image"]);
	assert.equal(models.some((entry) => entry.id === "kimi-k3"), false, "an alias must not add a model");
});

test("an unknown alias degrades to no hint instead of throwing", () => {
	const pack = definePack({ ...tierA(), aliases: { "chat-plain": "not-in-models-dev" } });
	const [model] = buildModels(pack, RECORDS, { modelsDev: buildModelIndex({}) }).filter((e) => e.id === "chat-plain");
	assert.equal(model?.provenance.limits.context, "default");
	assert.equal(model?.cost.output, 0);
});

test("a curated price beats the models.dev hint and says so", () => {
	const index = buildModelIndex({ p: { models: { "chat-vision": { cost: { input: 9, output: 9 } } } } });
	const pack = definePack({ ...tierA(), curated: { "chat-vision": { cost: { input: 0.5, output: 1.5 } } } });
	const model = buildModels(pack, RECORDS, { modelsDev: index }).find((e) => e.id === "chat-vision");
	assert.equal(model?.cost.input, 0.5);
	assert.equal(model?.cost.output, 1.5);
	assert.equal(model?.cost.cacheRead, 0, "unpublished fields stay zero rather than borrowing");
	assert.equal(model?.provenance.pricing, "curated");
});

test("efforts declared by the provider's own catalog win over models.dev", () => {
	const pack = definePack({
		...tierA(),
		fields: { ...tierA().fields, efforts: ["reasoningEfforts"] },
	});
	const index = buildModelIndex({ p: { models: { "chat-plain": { reasoning_options: [{ type: "effort", values: ["low"] }] } } } });
	const model = buildModels(pack, [{ id: "chat-plain", reasoningEfforts: ["high", "max"] }], { modelsDev: index }).find(
		(entry) => entry.id === "chat-plain",
	);
	assert.deepEqual(model?.thinking.efforts, ["high", "max"]);
	assert.equal(model?.provenance.effort, "catalog");
});

test("the route hook picks the wire api per model", () => {
	const pack = definePack({
		...tierA(),
		hooks: { route: (facts) => (facts.id.startsWith("claude") ? "anthropic-messages" : "openai-completions") },
	});
	const models = buildModels(pack, [{ id: "claude-x" }, { id: "gpt-y" }]);
	assert.equal(models.find((entry) => entry.id === "claude-x")?.api, "anthropic-messages");
	assert.equal(models.find((entry) => entry.id === "gpt-y")?.api, "openai-completions");
});

test("a model without a routed api keeps the host default", () => {
	const models = buildModels(tierA(), [{ id: "chat-plain" }]);
	assert.equal(models[0]?.api, undefined);
});

test("a normalize hook can set the wire api from the raw record", () => {
	const pack = definePack({
		...tierA(),
		hooks: { normalize: (record) => ({ api: String(record.protocol ?? "") }) },
	});
	const models = buildModels(pack, [{ id: "a", protocol: "anthropic-messages" }]);
	assert.equal(models[0]?.api, "anthropic-messages");
});
