import assert from "node:assert/strict";
import { test } from "node:test";

import { PACK_SCHEMA_VERSION, definePack, resolveLimit, validatePack, type Pack } from "../src/index.ts";

function basePack(): Pack {
	return {
		schemaVersion: PACK_SCHEMA_VERSION,
		id: "example",
		name: "Example",
		baseUrl: "https://api.example.test/v1",
		discovery: { path: "/models" },
	};
}

test("definePack accepts a minimal valid pack", () => {
	assert.equal(definePack(basePack()).id, "example");
});

test("schema version mismatch is rejected", () => {
	assert.throws(() => validatePack({ ...basePack(), schemaVersion: 99 }), /schemaVersion/);
});

test("baseUrl must be http(s)", () => {
	assert.throws(() => validatePack({ ...basePack(), baseUrl: "ftp://x" }), /baseUrl/);
});

test("discovery path must be absolute", () => {
	assert.throws(() => validatePack({ ...basePack(), discovery: { path: "models" } }), /discovery\.path/);
});

test("a positive timeout is required when set", () => {
	assert.throws(() => validatePack({ ...basePack(), discovery: { path: "/models", timeoutMs: 0 } }), /timeoutMs/);
});

test("curated keys must agree with their id", () => {
	assert.throws(() => validatePack({ ...basePack(), curated: { a: { id: "b" } } }), /disagrees/);
});

test("an invalid non-chat regex is rejected at import time", () => {
	assert.throws(() => validatePack({ ...basePack(), filter: { nonChatPattern: "[" } }), /regex/);
});

test("limit ladder prefers catalog, then curated, then models.dev, then default", () => {
	const ladder = (input: Parameters<typeof resolveLimit>[0]) => resolveLimit(input);
	assert.deepEqual(ladder({ catalog: 100, curated: 200, modelsDev: 300, defaultValue: 400 }), { value: 100, source: "catalog" });
	assert.deepEqual(ladder({ curated: 200, modelsDev: 300, defaultValue: 400 }), { value: 200, source: "curated" });
	assert.deepEqual(ladder({ modelsDev: 300, defaultValue: 400 }), { value: 300, source: "models.dev" });
	assert.deepEqual(ladder({ defaultValue: 400 }), { value: 400, source: "default" });
});

test("a limit can be capped by a dependent limit", () => {
	assert.deepEqual(resolveLimit({ catalog: 50_000, defaultValue: 1, capBy: 8_192 }), { value: 8_192, source: "catalog" });
});

test("an alias needs a non-empty id and target", () => {
	assert.throws(() => validatePack({ ...basePack(), aliases: { "": "x" } }), /aliases/);
	assert.throws(() => validatePack({ ...basePack(), aliases: { a: " " } }), /aliases/);
	assert.doesNotThrow(() => validatePack({ ...basePack(), aliases: { a: "b" } }));
});

test("a format override must target a Pi format", () => {
	assert.throws(() => validatePack({ ...basePack(), thinkingFormatOverrides: { x: "not-a-format" } }), /not a Pi format/);
	assert.throws(() => validatePack({ ...basePack(), thinkingFormatOverrides: { "": "openai" } }), /declared format/);
	assert.doesNotThrow(() => validatePack({ ...basePack(), thinkingFormatOverrides: { x: "openai" } }));
});

test("key files need a path and at least one field", () => {
	assert.throws(
		() => validatePack({ ...basePack(), auth: { kind: "bearer", keyFiles: [{ path: " ", keys: ["apiKey"] }] } }),
		/keyFiles/,
	);
	assert.throws(
		() => validatePack({ ...basePack(), auth: { kind: "bearer", keyFiles: [{ path: "/tmp/a.json", keys: [] }] } }),
		/keyFiles/,
	);
	assert.doesNotThrow(() =>
		validatePack({ ...basePack(), auth: { kind: "bearer", keyFiles: [{ path: "/tmp/a.json", keys: ["apiKey"] }] } }),
	);
});
