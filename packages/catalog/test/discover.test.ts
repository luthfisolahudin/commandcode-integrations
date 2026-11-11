import assert from "node:assert/strict";
import { test } from "node:test";

import { PACK_SCHEMA_VERSION, definePack, type Pack } from "@luthfisolahudin/commandcode-integrations-contract";

import { authHeaders, discover, resolveApiKey } from "../src/index.ts";

function pack(overrides: Partial<Pack> = {}): Pack {
	return definePack({
		schemaVersion: PACK_SCHEMA_VERSION,
		id: "example",
		name: "Example",
		baseUrl: "https://api.example.test/v1",
		auth: { kind: "bearer", apiKeyEnv: "EXAMPLE_API_KEY" },
		discovery: { path: "/models" },
		...overrides,
	});
}

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
	return new Response(JSON.stringify(body), {
		status: 200,
		headers: { "content-type": "application/json" },
		...init,
	});
}

test("the api key comes from the declared environment", () => {
	assert.equal(resolveApiKey(pack(), { EXAMPLE_API_KEY: "  secret  " }), "secret");
	assert.equal(resolveApiKey(pack(), {}), undefined);
	assert.equal(resolveApiKey(pack(), { EXAMPLE_API_KEY: "   " }), undefined);
});

test("an explicit literal key wins, and kind none sends no header", () => {
	assert.equal(resolveApiKey(pack({ auth: { kind: "bearer", apiKey: "literal" } }), {}), "literal");
	assert.deepEqual(authHeaders(pack({ auth: { kind: "none" } }), "secret"), {});
});

test("discovery sends bearer auth, a user agent, and parses the envelope", async () => {
	let seen: { url: string; headers: Headers } | undefined;
	const result = await discover(pack(), {
		apiKey: "k",
		now: () => 42,
		fetch: async (input, init) => {
			seen = { url: String(input), headers: new Headers(init?.headers) };
			return jsonResponse({ data: [{ id: "a" }] }, { headers: { etag: "v1" } });
		},
	});
	assert.equal(seen?.url, "https://api.example.test/v1/models");
	assert.equal(seen?.headers.get("authorization"), "Bearer k");
	assert.match(seen?.headers.get("user-agent") ?? "", /ai-provider-integrations/);
	assert.deepEqual(result.raw, [{ id: "a" }]);
	assert.equal(result.etag, "v1");
	assert.equal(result.checkedAt, 42);
	assert.equal(result.notModified, false);
});

test("an etag is sent back and a 304 keeps the caller's snapshot", async () => {
	let sentEtag: string | null = null;
	const result = await discover(pack(), {
		apiKey: "k",
		etag: "v1",
		fetch: async (_input, init) => {
			sentEtag = new Headers(init?.headers).get("if-none-match");
			return new Response(null, { status: 304 });
		},
	});
	assert.equal(sentEtag, "v1");
	assert.equal(result.notModified, true);
	assert.deepEqual(result.raw, []);
});

test("a non-ok response throws with the status", async () => {
	await assert.rejects(
		discover(pack(), { apiKey: "k", fetch: async () => new Response("nope", { status: 503 }) }),
		/HTTP 503/,
	);
});

test("a bespoke hook replaces the HTTP path entirely", async () => {
	let called = false;
	const result = await discover(
		pack({
			hooks: {
				discover: async (context) => {
					called = true;
					assert.equal(context.baseUrl, "https://api.example.test/v1");
					return [{ id: "hooked" }];
				},
			},
		}),
		{ fetch: async () => assert.fail("fetch must not be used") },
	);
	assert.equal(called, true);
	assert.deepEqual(result.raw.map((record) => record.id), ["hooked"]);
});

test("a hook that returns nothing is a configuration error", async () => {
	await assert.rejects(
		discover(pack({ hooks: { discover: async () => [] } })),
		/returned no models/,
	);
});

test("a key can come from a credential file when the environment is empty", async () => {
	const { mkdtempSync, writeFileSync } = await import("node:fs");
	const { tmpdir } = await import("node:os");
	const { join } = await import("node:path");
	const dir = mkdtempSync(join(tmpdir(), "xai-key-"));
	const file = join(dir, "auth.json");
	writeFileSync(file, JSON.stringify({ apiKeys: ["", "file-key"] }));
	const configured = pack({ auth: { kind: "bearer", apiKeyEnv: "MISSING_ENV", keyFiles: [{ path: file, keys: ["apiKey", "apiKeys"] }] } });
	assert.equal(resolveApiKey(configured, {}), "file-key");
	assert.equal(resolveApiKey(pack({ auth: { kind: "bearer", keyFiles: [{ path: join(dir, "absent.json"), keys: ["apiKey"] }] } }), {}), undefined);
});

test("the environment wins over a literal default and over files", () => {
	const configured = pack({ auth: { kind: "bearer", apiKeyEnv: "EXAMPLE_API_KEY", apiKey: "literal" } });
	assert.equal(resolveApiKey(configured, { EXAMPLE_API_KEY: "from-env" }), "from-env");
	assert.equal(resolveApiKey(configured, {}), "literal");
});
