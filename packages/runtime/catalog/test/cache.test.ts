import assert from "node:assert/strict";
import { mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { cacheDirectory, isFresh, readSnapshot, snapshotPath, writeSnapshot } from "../src/index.ts";

function tempDir(): string {
	return mkdtempSync(join(tmpdir(), "xai-cache-"));
}

test("cache lives outside the checkout, per platform", () => {
	assert.equal(
		cacheDirectory({ env: { XDG_CACHE_HOME: "/tmp/xdg" }, platform: "linux" }),
		join("/tmp/xdg", "ai-provider-integrations"),
	);
	assert.equal(
		cacheDirectory({ env: { LOCALAPPDATA: "C:\\cache" }, platform: "win32" }),
		join("C:\\cache", "ai-provider-integrations"),
	);
	assert.equal(
		cacheDirectory({ env: {}, platform: "linux", home: "/home/x" }),
		join("/home/x", ".cache", "ai-provider-integrations"),
	);
});

test("the snapshot path is namespaced by provider and sanitised", () => {
	const path = snapshotPath({ providerId: "weird/id", env: { XDG_CACHE_HOME: "/tmp/xdg" }, platform: "linux" });
	assert.equal(path, join("/tmp/xdg", "ai-provider-integrations", "weird_id.json"));
});

test("write then read round-trips a snapshot", () => {
	const dir = tempDir();
	try {
		const path = join(dir, "example.json");
		writeSnapshot(path, { checkedAt: 1_000, etag: "abc", raw: [{ id: "a" }] });
		assert.deepEqual(readSnapshot(path), { checkedAt: 1_000, etag: "abc", raw: [{ id: "a" }] });
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("a write leaves no temporary file behind", () => {
	const dir = tempDir();
	try {
		const path = join(dir, "example.json");
		writeSnapshot(path, { checkedAt: 1, raw: [{ id: "a" }] });
		assert.deepEqual(readdirSync(dir), ["example.json"]);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("a corrupt or shapeless snapshot reads as absent", () => {
	const dir = tempDir();
	try {
		const path = join(dir, "bad.json");
		writeFileSync(path, "{not json");
		assert.equal(readSnapshot(path), undefined);
		writeFileSync(path, JSON.stringify({ checkedAt: 1 }));
		assert.equal(readSnapshot(path), undefined);
		assert.equal(readSnapshot(join(dir, "missing.json")), undefined);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("freshness respects the ttl and rejects a future timestamp", () => {
	const snapshot = { checkedAt: 1_000, raw: [] };
	assert.equal(isFresh(snapshot, 500, 1_200), true);
	assert.equal(isFresh(snapshot, 100, 1_200), false);
	assert.equal(isFresh(snapshot, 10_000, 500), false);
});
