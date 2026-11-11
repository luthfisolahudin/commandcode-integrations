import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import {
	commandCodePack,
	mergeCatalog,
	normalizePricing,
	resolveProtocol,
	type ClientCatalog,
	type PublicModel,
} from "../src/index.ts";

const FIXTURES = join(import.meta.dirname, "../fixtures");
const client = JSON.parse(readFileSync(join(FIXTURES, "client-catalog.json"), "utf8")) as ClientCatalog;
const publicModels = (() => {
	const body = JSON.parse(readFileSync(join(FIXTURES, "models.json"), "utf8")) as PublicModel[] | { data?: PublicModel[] };
	return Array.isArray(body) ? body : (body.data ?? []);
})();

test("claude models route to Anthropic Messages, everything else prefers chat", () => {
	assert.equal(resolveProtocol({ id: "claude-sonnet-5-5", endpoints: ["/chat/completions"] }).protocol, "anthropic-messages");
	assert.equal(
		resolveProtocol({ id: "claude-sonnet-5-5", endpoints: ["/messages"] }).reason,
		"anthropic-model",
	);
	assert.equal(resolveProtocol({ id: "gpt-5.5", endpoints: ["/chat/completions", "/responses"] }).protocol, "openai-completions");
	assert.equal(resolveProtocol({ id: "x", endpoints: ["/messages"] }).protocol, "anthropic-messages");
	assert.equal(resolveProtocol({ id: "y", endpoints: ["/responses"] }).protocol, "openai-responses");
	assert.equal(resolveProtocol({ id: "z", endpoints: [] }).reason, "default-unverified");
});

test("client facts win, the public list supplies endpoints", () => {
	const records = mergeCatalog(
		{
			schemaVersion: 1,
			catalogVersion: "v1",
			data: [{ id: "model-a", display: { label: "Model A", group: "OpenAI" }, context_length: 400_000, reasoningEfforts: ["low", "max"] }],
		},
		[{ id: "model-a", name: "Public A", context_length: 200_000, supported_endpoints: ["/chat/completions"] }],
	);
	assert.equal(records.length, 1);
	const record = records[0]!;
	assert.equal(record.name, "Model A", "client label wins");
	assert.equal(record.context_length, 400_000, "client context wins");
	assert.deepEqual(record.supported_endpoints, ["/chat/completions"]);
	assert.deepEqual(record.reasoningEfforts, ["low", "max"]);
});

test("a model only in the public list still appears, without efforts or price", () => {
	const records = mergeCatalog(
		{ schemaVersion: 1, catalogVersion: "v1", data: [] },
		[{ id: "public-only", name: "Public Only", supported_endpoints: ["/chat/completions"] }],
	);
	assert.equal(records.length, 1);
	assert.deepEqual(records[0]?.reasoningEfforts, []);
	assert.equal(records[0]?.pricing, undefined);
});

test("hidden models never reach a picker", () => {
	const records = mergeCatalog(
		{
			schemaVersion: 1,
			catalogVersion: "v1",
			data: [
				{ id: "visible" },
				{ id: "secret", hidden: true },
			],
		},
		[],
	);
	assert.deepEqual(records.map((record) => record.id), ["visible"]);
});

test("efforts are filtered to the enum CommandCode accepts", () => {
	const records = mergeCatalog(
		{ schemaVersion: 1, catalogVersion: "v1", data: [{ id: "m", reasoningEfforts: ["minimal", "low", "nonsense", "max"] }] },
		[],
	);
	assert.deepEqual(records[0]?.reasoningEfforts, ["low", "max"]);
});

test("pricing converts per-token to per-million and never borrows a cache price", () => {
	assert.deepEqual(normalizePricing({ inputCost: 0.000003, outputCost: 0.000015, cacheReadCost: 0.0000003 }), {
		input: 3,
		output: 15,
		cacheRead: 0.3,
		cacheWrite: 0,
	});
	assert.equal(normalizePricing({ contextTiers: [{ maxContext: 100 }] }), undefined);
	assert.equal(normalizePricing(undefined), undefined);
});

test("the captured catalog routes to both protocols and drops nothing visible", () => {
	const records = mergeCatalog(client, publicModels);
	assert.ok(records.length >= 90, `only ${records.length} models merged`);
	const anthropic = records.filter((record) => record.protocol === "anthropic-messages");
	const chat = records.filter((record) => record.protocol === "openai-completions");
	const responses = records.filter((record) => record.protocol === "openai-responses");
	assert.ok(anthropic.length >= 10, `only ${anthropic.length} anthropic models`);
	assert.ok(chat.length >= 80, `only ${chat.length} chat models`);
	assert.equal(responses.length, 0, "no model routes to Responses while chat is available");
	assert.ok(anthropic.every((record) => record.id.toLowerCase().includes("claude")));
	assert.equal(new Set(records.map((record) => record.id)).size, records.length, "ids are unique");
});

test("the pack declares where its facts live and how to authenticate", () => {
	assert.ok(Object.keys(commandCodePack.fields ?? {}).length > 0);
	assert.equal(commandCodePack.auth?.apiKeyEnv, "COMMANDCODE_API_KEY");
	assert.ok((commandCodePack.auth?.keyFiles ?? []).length >= 1);
	assert.equal(commandCodePack.hooks?.discover !== undefined, true);
});

test("the committed catalog fixture is the merge of the two captured views", () => {
	const committed = JSON.parse(readFileSync(join(FIXTURES, "catalog.json"), "utf8")) as { data: unknown[] };
	const merged = mergeCatalog(client, publicModels);
	assert.deepEqual(committed.data, merged, "fixtures/catalog.json drifted from the captured views; regenerate it");
});
