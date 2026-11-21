import assert from "node:assert/strict";
import { test } from "node:test";

import { checkImport, checkImport as check, FORBIDDEN, layerOfSpecifier } from "@luthfisolahudin/ai-integrations-cli";

test("workspace packages map to layers", () => {
	assert.equal(layerOfSpecifier("@luthfisolahudin/ai-integrations-contract")?.layer, "contract");
	assert.equal(layerOfSpecifier("@luthfisolahudin/ai-integrations-catalog")?.layer, "catalog");
	// The head decides: upstream runtime packages are factories, vendor packages
	// with the same tail are that checkout's wiring.
	assert.equal(layerOfSpecifier("@luthfisolahudin/ai-integrations-pi/model")?.layer, "factory");
	assert.equal(layerOfSpecifier("@luthfisolahudin/ai-integrations-opencode")?.layer, "factory");
	assert.equal(layerOfSpecifier("@luthfisolahudin/example-integrations-pi")?.layer, "adapter");
	assert.equal(layerOfSpecifier("@luthfisolahudin/9router-integrations-pi")?.layer, "adapter");
	assert.equal(layerOfSpecifier("node:fs"), undefined);
	assert.equal(layerOfSpecifier("@earendil-works/pi-ai/compat"), undefined);
});

test("the forbidden directions are exactly the ones the docs claim", () => {
	assert.deepEqual(FORBIDDEN.contract, ["catalog", "provider", "factory", "adapter", "example", "cli", "conformance"]);
	assert.ok(FORBIDDEN.adapter.includes("adapter"));
	assert.ok(!FORBIDDEN.adapter.includes("factory"));
	assert.ok(FORBIDDEN.catalog.includes("provider"));
	assert.ok(FORBIDDEN.provider.includes("catalog"));
	assert.ok(FORBIDDEN.provider.includes("adapter"));
	assert.ok(FORBIDDEN.cli.includes("adapter"));
	assert.deepEqual(FORBIDDEN.conformance, []);
});

test("a violation carries enough context to fix it", () => {
	const violation = check({ file: "packages/provider/src/pack.ts", line: 3, specifier: "@luthfisolahudin/ai-integrations-catalog", from: "provider" });
	assert.ok(violation);
	assert.equal(violation.to, "catalog");
});

test("allowed directions pass silently", () => {
	assert.equal(checkImport({ file: "packages/runtime/catalog/src/x.ts", line: 1, specifier: "@luthfisolahudin/ai-integrations-contract", from: "catalog" }), undefined);
	assert.equal(checkImport({ file: "adapters/pi/src/x.ts", line: 1, specifier: "#provider", from: "adapter" }), undefined);
	// Wiring may use the factory; two wirings may not touch.
	assert.equal(checkImport({ file: "adapters/pi/src/x.ts", line: 1, specifier: "@luthfisolahudin/ai-integrations-pi", from: "adapter" }), undefined);
	assert.ok(check({ file: "adapters/gutsai/src/x.ts", line: 1, specifier: "@luthfisolahudin/other-integrations-pi", from: "adapter" }));
	// A factory is reached only through its own package name; the `#provider`
	// alias is enforced structurally — only cli and conformance declare it in
	// their package.json `imports`, so a factory importing it fails resolution.
	assert.equal(layerOfSpecifier("#provider"), undefined);
});

test("the layer comes from the package suffix, not a package list", () => {
	// A downstream checkout deletes `examples/`, so a hardcoded entry for a
	// `tier-b`/`tier-c` package would describe something that does not exist.
	// Deriving the layer from the suffix keeps one rule for every checkout.
	assert.equal(layerOfSpecifier("@luthfisolahudin/example-integrations-tier-b")?.layer, "example");
	assert.equal(layerOfSpecifier("@luthfisolahudin/ai-integrations-conformance")?.layer, "conformance");
	assert.equal(layerOfSpecifier("@luthfisolahudin/any-other-repo-catalog")?.layer, "catalog");
	assert.equal(layerOfSpecifier("catalog")?.layer, "catalog");
	assert.equal(layerOfSpecifier("provider")?.layer, "provider");
	// An unknown suffix is not a workspace package.
	assert.equal(layerOfSpecifier("@luthfisolahudin/any-other-repo-nonexistent"), undefined);
});
