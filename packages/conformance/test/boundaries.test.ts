import assert from "node:assert/strict";
import { test } from "node:test";

import { checkImport, checkImport as check, FORBIDDEN, layerOfSpecifier } from "@luthfisolahudin/commandcode-integrations-cli";

test("workspace packages map to layers", () => {
	assert.equal(layerOfSpecifier("@luthfisolahudin/commandcode-integrations-contract")?.layer, "contract");
	assert.equal(layerOfSpecifier("@luthfisolahudin/commandcode-integrations-catalog")?.layer, "catalog");
	assert.equal(layerOfSpecifier("@luthfisolahudin/commandcode-integrations-pi/model")?.layer, "adapter");
	assert.equal(layerOfSpecifier("node:fs"), undefined);
	assert.equal(layerOfSpecifier("@earendil-works/pi-ai/compat"), undefined);
});

test("the forbidden directions are exactly the ones the docs claim", () => {
	assert.deepEqual(FORBIDDEN.contract, ["catalog", "provider", "adapter", "example", "cli", "conformance"]);
	assert.ok(FORBIDDEN.catalog.includes("provider"));
	assert.ok(FORBIDDEN.provider.includes("catalog"));
	assert.ok(FORBIDDEN.provider.includes("adapter"));
	assert.ok(FORBIDDEN.cli.includes("adapter"));
	assert.deepEqual(FORBIDDEN.conformance, []);
});

test("a violation carries enough context to fix it", () => {
	const violation = check({ file: "packages/provider/src/pack.ts", line: 3, specifier: "@luthfisolahudin/commandcode-integrations-catalog", from: "provider" });
	assert.ok(violation);
	assert.equal(violation.to, "catalog");
});

test("allowed directions pass silently", () => {
	assert.equal(checkImport({ file: "packages/catalog/src/x.ts", line: 1, specifier: "@luthfisolahudin/commandcode-integrations-contract", from: "catalog" }), undefined);
	assert.equal(checkImport({ file: "adapters/pi/src/x.ts", line: 1, specifier: "@luthfisolahudin/commandcode-integrations-provider", from: "adapter" }), undefined);
});
