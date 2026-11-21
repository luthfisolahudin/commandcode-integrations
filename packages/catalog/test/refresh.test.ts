import assert from "node:assert/strict";
import { test } from "node:test";
import { PACK_SCHEMA_VERSION, definePack } from "../../../engine/contract/index.ts";

import { refreshCatalog, type Snapshot } from "../src/index.ts";

const pack = definePack({
	schemaVersion: PACK_SCHEMA_VERSION,
	id: "fixture",
	name: "Fixture",
	baseUrl: "https://fixture.test",
	discovery: { path: "/models", etag: true },
	fallback: [{ id: "startup" }],
});

const snapshot: Snapshot = { raw: [{ id: "retired" }], etag: "v1", checkedAt: 10 };

test("a successful empty response replaces existing models and the offline fallback", async () => {
	const result = await refreshCatalog(pack, {
		snapshot,
		fetch: async () => Response.json({ data: [] }),
		now: () => 20,
	});
	assert.equal(result.source, "network");
	assert.deepEqual(result.models, []);
	assert.deepEqual(result.snapshot?.raw, []);
});

test("discovery failure keeps an empty snapshot ahead of the cold-start fallback", async () => {
	const failures: typeof fetch = async () => new Response(null, { status: 503 });
	const warm = await refreshCatalog(pack, { snapshot: { ...snapshot, raw: [] }, fetch: failures });
	assert.equal(warm.source, "snapshot");
	assert.match(warm.error?.message ?? "", /503/);
	assert.deepEqual(warm.models, []);
	const cold = await refreshCatalog(pack, { fetch: failures });
	assert.equal(cold.source, "fallback");
	assert.deepEqual(cold.models.map(({ id }) => id), ["startup"]);
});

test("conditional refresh sends the expired ETag and advances freshness on 304", async () => {
	const result = await refreshCatalog(pack, {
		snapshot,
		now: () => 20,
		fetch: async (_url, request) => {
			assert.equal(new Headers(request?.headers).get("If-None-Match"), "v1");
			return new Response(null, { status: 304 });
		},
	});
	assert.equal(result.source, "network");
	assert.deepEqual(result.snapshot, { ...snapshot, checkedAt: 20 });
});
