import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { buildModelIndex, loadModelIndex, MODELS_DEV_URL, readCachedModelIndex } from "../src/index.ts";

const CATALOG = {
	p: { models: { "gpt-5.4": { limit: { context: 1_050_000, output: 128_000 }, cost: { input: 2.5, output: 10 } } } },
};

function tempDir(): string {
	return mkdtempSync(join(tmpdir(), "xai-modelsdev-"));
}

function respond(): Response {
	return new Response(JSON.stringify(CATALOG), { status: 200, headers: { "content-type": "application/json" } });
}

test("a fresh cache is used without touching the network", async () => {
	const dir = tempDir();
	try {
		const cachePath = join(dir, "models.dev.json");
		writeFileSync(cachePath, JSON.stringify({ checkedAt: 1_000, catalog: CATALOG }));
		let fetched = false;
		const index = await loadModelIndex({
			cachePath,
			now: () => 2_000,
			fetch: async () => {
				fetched = true;
				return respond();
			},
		});
		assert.equal(fetched, false);
		assert.equal(index.get("gpt-5.4")?.contextWindow, 1_050_000);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("a stale cache refetches and rewrites the cache", async () => {
	const dir = tempDir();
	try {
		const cachePath = join(dir, "models.dev.json");
		writeFileSync(cachePath, JSON.stringify({ checkedAt: 1_000, catalog: { p: { models: { old: {} } } } }));
		let fetched = 0;
		const index = await loadModelIndex({
			cachePath,
			now: () => 1_000 + 48 * 60 * 60 * 1_000,
			fetch: async (input) => {
				fetched += 1;
				assert.equal(String(input), MODELS_DEV_URL);
				return respond();
			},
		});
		assert.equal(fetched, 1);
		assert.equal(index.get("gpt-5.4")?.maxOutput, 128_000);
		assert.equal(readCachedModelIndex(cachePath)?.get("gpt-5.4")?.contextWindow, 1_050_000);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("a failed fetch falls back to the stale cache, then to an empty index", async () => {
	const dir = tempDir();
	try {
		const stalePath = join(dir, "stale.json");
		writeFileSync(stalePath, JSON.stringify({ checkedAt: 0, catalog: CATALOG }));
		const stale = await loadModelIndex({
			cachePath: stalePath,
			now: () => 10 * 24 * 60 * 60 * 1_000,
			fetch: async () => {
				throw new Error("offline");
			},
		});
		assert.equal(stale.get("gpt-5.4")?.contextWindow, 1_050_000);

		const empty = await loadModelIndex({
			cachePath: join(dir, "missing.json"),
			fetch: async () => new Response("nope", { status: 503 }),
		});
		assert.equal(empty.size, 0);
		assert.equal(empty.get("anything"), undefined);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("a corrupt cache is treated as absent", () => {
	const dir = tempDir();
	try {
		const cachePath = join(dir, "bad.json");
		writeFileSync(cachePath, "{not json");
		assert.equal(readCachedModelIndex(cachePath), undefined);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("the index exposes cost only when published", () => {
	const index = buildModelIndex(CATALOG);
	assert.deepEqual(index.get("gpt-5.4")?.cost, { input: 2.5, output: 10 });
	assert.equal(buildModelIndex({ p: { models: { m: { limit: { context: 1 } } } } }).get("m")?.cost, undefined);
});
