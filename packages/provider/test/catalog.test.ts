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

test("routing prefers Messages for Claude when the catalog advertises it", () => {
	assert.equal(resolveProtocol({ id: "claude-sonnet-5-5", endpoints: ["/chat/completions"] }).protocol, "openai-completions");
	assert.equal(
		resolveProtocol({ id: "claude-sonnet-5-5", endpoints: ["/messages"] }).reason,
		"anthropic-model",
	);
	assert.equal(resolveProtocol({ id: "gpt-5.5", endpoints: ["/chat/completions", "/responses"] }).protocol, "openai-completions");
	assert.equal(resolveProtocol({ id: "x", endpoints: ["/messages", "/embeddings"] }).protocol, "anthropic-messages");
	assert.equal(resolveProtocol({ id: "y", endpoints: ["/responses"] }).protocol, "openai-responses");
	assert.equal(resolveProtocol({ id: "z", endpoints: [] }).reason, "default-unverified");
	assert.equal(resolveProtocol({ id: "embedding", endpoints: ["/embeddings"] }).protocol, undefined);
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

test("public-only chat models appear without effort or price and embedding models are skipped", () => {
	const records = mergeCatalog(
		{ schemaVersion: 1, catalogVersion: "v1", data: [] },
		[
			{ id: "public-only", name: "Public Only", supported_endpoints: ["/chat/completions"] },
			{ id: "embedding", supported_endpoints: ["/embeddings"] },
		],
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
		[{ id: "secret", supported_endpoints: ["/chat/completions"] }],
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
	});
	assert.equal(normalizePricing({ contextTiers: [{ maxContext: 100 }] }), undefined);
	assert.equal(normalizePricing(undefined), undefined);
	assert.deepEqual(normalizePricing({ inputCost: 0, outputCost: 0 }), { input: 0, output: 0 });
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

test("discovery distinguishes a valid empty catalog from a partial outage", async (t) => {
	const context = { baseUrl: "https://fixture.test", headers: {}, signal: AbortSignal.timeout(1_000) };
	const discover = commandCodePack.hooks!.discover!;
	const client = { schemaVersion: 1, catalogVersion: "fixture", data: [] };
	const fetch = t.mock.method(globalThis, "fetch", async (url: string) => Response.json(url.endsWith("?view=client") ? client : []));
	assert.deepEqual(await discover(context), []);
	fetch.mock.mockImplementation(async (url: string) => url.endsWith("?view=client") ? Response.json(client) : new Response(null, { status: 503 }));
	await assert.rejects(discover(context), /incomplete CommandCode catalog/);
});
