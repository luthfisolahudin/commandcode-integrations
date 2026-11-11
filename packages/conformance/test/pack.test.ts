import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { capabilityView, type RawRecord } from "@luthfisolahudin/commandcode-integrations-contract";

import { invariants, packs } from "@luthfisolahudin/commandcode-integrations-provider";

/**
 * Sanity gate for the vendor surface. It stays contract-only on purpose: the
 * provider package may not import the catalog, so value assertions against
 * projected models live in `task check:catalog` and the conformance suite.
 */
const payload = JSON.parse(readFileSync(join(import.meta.dirname, "../../../packages/provider/fixtures/catalog.json"), "utf8")) as
	| RawRecord[]
	| { data?: RawRecord[]; models?: RawRecord[] };

const pack = packs[0]!;
const records: RawRecord[] = Array.isArray(payload) ? payload : (payload.data ?? payload.models ?? []);
const fixtureIds = new Set(records.map((record) => String(record.id)));

test("the fixture is a catalog the pack can read", () => {
	assert.ok(records.length > 0, "packages/provider/fixtures/catalog.json has no records");
	assert.ok(fixtureIds.size === records.length, "the fixture contains duplicate ids");
});

test("every curated id is known: in the fixture or a pinned fallback", () => {
	const fallbacks = new Set((pack.fallback ?? []).map((entry) => entry.id));
	for (const id of Object.keys(pack.curated ?? {})) {
		// Curated facts exist for a model the catalog may not list right now, such as
		// a pinned offline fallback. It still has to be a model this pack knows.
		const known = fixtureIds.has(id) || fallbacks.has(id);
		assert.ok(known, `curated entry "${id}" is neither in the fixture nor a fallback (typo or retired model)`);
	}
});

test("every pinned fallback is known: in the fixture or curated", () => {
	for (const entry of pack.fallback ?? []) {
		// A router's membership follows its connection set, so a pinned fallback may
		// currently be absent from the catalog. What it cannot be is unknown: an
		// offline start still has to describe the model it offers.
		const known = fixtureIds.has(entry.id) || pack.curated?.[entry.id] !== undefined;
		assert.ok(known, `fallback "${entry.id}" is neither in the fixture nor curated`);
	}
	assert.ok((pack.fallback ?? []).length <= 3, "keep the fallback minimal; it is a floor, not a catalog");
});

// An invariant may name a model that is currently absent: curation waits for it to
// come back, and `task check:catalog` reports those instead of failing. That check
// runs inside `task check`, so a typo is still caught on every push.
test("invariants carry a note explaining where the fact came from", () => {
	for (const invariant of invariants) {
		assert.ok(invariant.note.trim().length > 10, `${invariant.id} needs a note`);
	}
});

test("the pack declares where its facts live", () => {
	const fields = Object.entries(pack.fields ?? {});
	assert.ok(fields.length > 0, "fields must alias at least one fact");
	for (const [name, paths] of fields) {
		assert.ok(Array.isArray(paths) && paths.length > 0, `fields.${name} must list at least one path`);
	}
});

test("the pack names its credential source or is explicitly keyless", () => {
	const auth = pack.auth;
	assert.ok(auth?.apiKeyEnv !== undefined || auth?.apiKey !== undefined || auth?.kind === "none");
});

test("capability reads never throw on the real payload", () => {
	for (const record of records) {
		assert.doesNotThrow(() => capabilityView(record, pack.fields), String(record.id));
	}
});

test("the repo declares at least one pack", () => {
	assert.ok(packs.length >= 1);
});
