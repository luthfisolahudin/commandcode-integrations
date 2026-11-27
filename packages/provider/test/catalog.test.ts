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

test("zdr is carried from the client view and stays absent when unstated", () => {
	const records = mergeCatalog(
		{
			schemaVersion: 1,
			catalogVersion: "v1",
			data: [
				{ id: "retained", zdr: true },
				{ id: "logged", zdr: false },
				{ id: "unstated" },
			],
		},
		[
			{ id: "retained", supported_endpoints: ["/chat/completions"] },
			{ id: "logged", supported_endpoints: ["/chat/completions"] },
			{ id: "public-only", supported_endpoints: ["/chat/completions"] },
		],
	);
	const byId = new Map(records.map((record) => [record.id, record]));
	assert.equal(byId.get("retained")?.zdr, true);
	assert.equal(byId.get("logged")?.zdr, false);
	// Absent stays absent: a model the client view never described is `unknown`,
	// not "retains nothing". The pack must not promote silence into a guarantee.
	assert.equal(byId.get("unstated")?.zdr, undefined);
	assert.equal(byId.get("public-only")?.zdr, undefined);
});

test("pricing passes the catalog's per-1M rates through unchanged", () => {
	// Rates published at https://commandcode.ai/docs/plans/goat, which states
	// "Rates are per 1M tokens": Claude Sonnet 5.5 $2.00 in / $10.00 out /
	// $0.10 cache read / $2.50 cache write. The catalog reports exactly these,
	// so any conversion here is a 1,000,000x pricing bug that still typechecks.
	assert.deepEqual(normalizePricing({ inputCost: 2, outputCost: 10, cacheReadCost: 0.1, cacheWriteCost: 2.5 }), {
		input: 2,
		output: 10,
		cacheRead: 0.1,
		cacheWrite: 2.5,
	});
	// Claude Haiku 5.5: $0.10 / $0.50 / $0.01 / $0.125.
	assert.deepEqual(normalizePricing({ inputCost: 0.1, outputCost: 0.5, cacheReadCost: 0.01, cacheWriteCost: 0.125 }), {
		input: 0.1,
		output: 0.5,
		cacheRead: 0.01,
		cacheWrite: 0.125,
	});
	assert.equal(normalizePricing({ contextTiers: [{ maxContext: 100 }] }), undefined);
	assert.equal(normalizePricing(undefined), undefined);
	assert.deepEqual(normalizePricing({ inputCost: 0, outputCost: 0 }), { input: 0, output: 0 });
});

test("the fixture's prices match the vendor's published table", () => {
	// A price list is the one fact a typo makes silently wrong: it renders as a
	// plausible number in every picker. Pin a few rows against the docs.
	const published: Readonly<Record<string, readonly [number, number, number, number | undefined]>> = {
		"claude-sonnet-5-5": [2, 10, 0.1, 2.5],
		"claude-haiku-5-5": [0.1, 0.5, 0.01, 0.125],
		"gpt-6-luna": [0.1, 0.5, 0.01, 0.125],
	};
	for (const [id, [input, output, cacheRead, cacheWrite]] of Object.entries(published)) {
		const model = client.data.find((entry) => entry.id === id);
		assert.ok(model?.pricing !== undefined, `${id} has no pricing in the captured client catalog`);
		assert.equal(model.pricing.inputCost, input, `${id} input`);
		assert.equal(model.pricing.outputCost, output, `${id} output`);
		assert.equal(model.pricing.cacheReadCost, cacheRead, `${id} cache read`);
		assert.equal(model.pricing.cacheWriteCost, cacheWrite, `${id} cache write`);
	}
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

test("every visible model states its ZDR capability", () => {
	// The client view is the only source of this fact, and every visible entry
	// currently declares it. A missing flag would make the picker silently drop
	// a guarantee it never had, so pin the declaration rate rather than a count.
	const records = mergeCatalog(client, publicModels);
	const undeclared = records.filter((record) => typeof record.zdr !== "boolean");
	assert.deepEqual(undeclared.map((record) => record.id), [], "models with no declared zdr");
	assert.ok(records.some((record) => record.zdr === true), "no ZDR-capable model at all");
	assert.ok(records.some((record) => record.zdr === false), "no non-ZDR model at all");

	// Anthropic retains Fable prompts for 30 days, so these can never be ZDR.
	// https://commandcode.ai/docs/resources/zdr — "Claude Fable 5 and 5.1 are always
	// in this group". A vendor doc that contradicts the catalog is exactly what this
	// pin is for.
	for (const id of ["claude-fable-5", "claude-fable-5-1", "claude-fable-5-2"]) {
		assert.equal(records.find((record) => record.id === id)?.zdr, false, `${id} must not claim ZDR`);
	}
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
