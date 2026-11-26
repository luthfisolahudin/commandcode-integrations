import assert from "node:assert/strict";
import { test } from "node:test";

import { PACK_SCHEMA_VERSION, definePack, type Pack } from "@luthfisolahudin/ai-integrations-contract";

import { collectQuota, fetchQuota, handleQuotaRequest } from "../src/index.ts";

function makeQuotaPack(id: string, quota: NonNullable<Pack["hooks"]>["quota"]): Pack {
	return definePack({
		schemaVersion: PACK_SCHEMA_VERSION,
		id,
		name: id,
		baseUrl: "https://api.example.test/v1",
		auth: { kind: "bearer", apiKey: "test-key" },
		discovery: { path: "/models" },
		hooks: quota === undefined ? undefined : { quota },
	});
}

test("fetchQuota throws when pack has no quota hook", async () => {
	const pack = makeQuotaPack("plain", undefined);
	await assert.rejects(() => fetchQuota(pack), /does not implement quota/);
});

test("fetchQuota attaches providerInstanceId fallback and validates accounts", async () => {
	let seenAuth = "";
	const pack = makeQuotaPack("cc", async (context) => {
		seenAuth = context.headers["Authorization"] ?? "";
		return [
			{
				id: "acc-1",
				label: "Test Account",
				windows: [{ id: "5h", kind: "session", label: "5-hour limit", usedPercent: 40 }],
			},
		];
	});

	const result = await fetchQuota(pack, { providerInstanceId: "opencode" });
	assert.equal(seenAuth, "Bearer test-key");
	assert.deepEqual(result.response, {
		version: 1,
		accounts: [
			{
				id: "acc-1",
				label: "Test Account",
				providerInstanceId: "opencode",
				windows: [{ id: "5h", kind: "session", label: "5-hour limit", usedPercent: 40 }],
			},
		],
	});
});

test("handleQuotaRequest enforces bearer token, method, and path", async () => {
	const pack = makeQuotaPack("cc", async () => [
		{ id: "acc-1", label: "CC", windows: [{ id: "m", kind: "monthly", label: "Credits", usedPercent: 10 }] },
	]);
	const options = { packs: [pack], token: "secret-token" };

	const post = await handleQuotaRequest({ method: "POST", path: "/" }, options);
	assert.equal(post.status, 405);

	const unauth = await handleQuotaRequest({ method: "GET", path: "/" }, options);
	assert.equal(unauth.status, 401);

	const notFound = await handleQuotaRequest({ method: "GET", path: "/unknown", authorization: "Bearer secret-token" }, options);
	assert.equal(notFound.status, 404);

	const health = await handleQuotaRequest({ method: "GET", path: "/health" }, options);
	assert.equal(health.status, 200);

	const ok = await handleQuotaRequest({ method: "GET", path: "/quota", authorization: "Bearer secret-token" }, options);
	assert.equal(ok.status, 200);
	assert.deepEqual(JSON.parse(ok.body), {
		version: 1,
		accounts: [{ id: "acc-1", label: "CC", windows: [{ id: "m", kind: "monthly", label: "Credits", usedPercent: 10 }] }],
	});
});

test("handleQuotaRequest returns 502 when all quota packs fail and 200 when one succeeds", async () => {
	const failing = makeQuotaPack("bad", async () => {
		throw new Error("upstream down");
	});
	const working = makeQuotaPack("good", async () => [
		{ id: "acc-2", label: "Good", windows: [] },
	]);

	const allFail = await handleQuotaRequest({ method: "GET", path: "/" }, { packs: [failing] });
	assert.equal(allFail.status, 502);

	const partial = await collectQuota([failing, working]);
	assert.equal(partial.errors.length, 1);
	assert.equal(partial.response.accounts.length, 1);
});
