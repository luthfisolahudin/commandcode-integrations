import assert from "node:assert/strict";
import { test } from "node:test";

import { checkImport, checkImport as check, FORBIDDEN, layerOfSpecifier } from "../../cli/src/index.ts";

test("workspace packages map to layers", () => {
	assert.equal(layerOfSpecifier("@luthfisolahudin/ai-provider-integrations-template-contract")?.layer, "contract");
	assert.equal(layerOfSpecifier("@luthfisolahudin/ai-provider-integrations-template-catalog")?.layer, "catalog");
	assert.equal(layerOfSpecifier("@luthfisolahudin/ai-provider-integrations-template-pi/model")?.layer, "adapter");
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
	const violation = check({ file: "packages/provider/src/pack.ts", line: 3, specifier: "@luthfisolahudin/ai-provider-integrations-template-catalog", from: "provider" });
	assert.ok(violation);
	assert.equal(violation.to, "catalog");
});

test("allowed directions pass silently", () => {
	assert.equal(checkImport({ file: "packages/catalog/src/x.ts", line: 1, specifier: "@luthfisolahudin/ai-provider-integrations-template-contract", from: "catalog" }), undefined);
	assert.equal(checkImport({ file: "adapters/pi/src/x.ts", line: 1, specifier: "@luthfisolahudin/ai-provider-integrations-template-provider", from: "adapter" }), undefined);
});

test("the layer comes from the package suffix, not a package list", () => {
	// A downstream checkout deletes `examples/`, so a hardcoded entry for a
	// `tier-b`/`tier-c` package would describe something that does not exist.
	// Deriving the layer from the suffix keeps one rule for every checkout.
	assert.equal(layerOfSpecifier("@luthfisolahudin/ai-provider-integrations-template-tier-b")?.layer, "example");
	assert.equal(layerOfSpecifier("@luthfisolahudin/ai-provider-integrations-template-conformance")?.layer, "conformance");
	assert.equal(layerOfSpecifier("@luthfisolahudin/any-other-repo-catalog")?.layer, "catalog");
	assert.equal(layerOfSpecifier("catalog")?.layer, "catalog");
	assert.equal(layerOfSpecifier("provider")?.layer, "provider");
	// An unknown suffix is not a workspace package.
	assert.equal(layerOfSpecifier("@luthfisolahudin/any-other-repo-nonexistent"), undefined);
});
