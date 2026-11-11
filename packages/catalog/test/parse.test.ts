import assert from "node:assert/strict";
import { test } from "node:test";

import { parseEnvelope } from "../src/index.ts";

test("accepts openai data envelopes", () => {
	const records = parseEnvelope({ object: "list", data: [{ id: "a" }, { id: "b" }] });
	assert.deepEqual(records.map((record) => record.id), ["a", "b"]);
});

test("accepts models envelopes and bare arrays", () => {
	assert.deepEqual(parseEnvelope({ models: [{ id: "a" }] }).map((r) => r.id), ["a"]);
	assert.deepEqual(parseEnvelope([{ id: "a" }]).map((r) => r.id), ["a"]);
});

test("accepts a single record", () => {
	assert.deepEqual(parseEnvelope({ id: "solo" }).map((r) => r.id), ["solo"]);
});

test("rejects an empty or shapeless payload", () => {
	assert.throws(() => parseEnvelope({}), /no model records/);
	assert.throws(() => parseEnvelope([]), /no model records/);
	assert.throws(() => parseEnvelope({ data: [] }), /no model records/);
	assert.throws(() => parseEnvelope("nope"), /no model records/);
});

test("rejects a record without a usable id", () => {
	assert.throws(() => parseEnvelope({ data: [{ id: "" }] }), /without a usable id/);
	assert.throws(() => parseEnvelope({ data: [{ id: 7 }] }), /without a usable id/);
	assert.throws(() => parseEnvelope({ data: [null] }), /non-object record/);
});

test("rejects duplicate ids instead of silently hiding one", () => {
	assert.throws(() => parseEnvelope({ data: [{ id: "a" }, { id: "a" }] }), /duplicate id: a/);
});

test("does not mutate the provider's record shape", () => {
	const records = parseEnvelope({ data: [{ id: "a", capabilities: { vision: true } }] });
	assert.deepEqual(records[0], { id: "a", capabilities: { vision: true } });
});
