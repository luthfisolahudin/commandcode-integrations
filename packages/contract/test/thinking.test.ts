import assert from "node:assert/strict";
import { test } from "node:test";

import { mapThinkingFormat, unmappedFormats } from "../src/index.ts";

test("the four formats Pi can reproduce map through", () => {
	for (const format of ["openai", "deepseek", "qwen", "zai"]) {
		assert.deepEqual(mapThinkingFormat(format), { pi: format, declared: format });
	}
});

test("formats Pi has no equivalent for stay unmapped rather than guessed", () => {
	for (const format of ["kimi", "gemini-level", "minimax", "step"]) {
		const mapping = mapThinkingFormat(format);
		assert.equal(mapping.pi, undefined);
		assert.equal(mapping.reason, "unmapped");
	}
});

test("no declaration is not the same as an unmapped declaration", () => {
	assert.deepEqual(mapThinkingFormat(undefined), { reason: "none", declared: "" });
	assert.deepEqual(mapThinkingFormat("  "), { reason: "none", declared: "" });
});

test("a pack may record a measured equivalence", () => {
	assert.deepEqual(mapThinkingFormat("kimi", { kimi: "openai" }), { pi: "openai", declared: "kimi" });
});

test("declared formats are reported as the set that still needs a probe", () => {
	assert.deepEqual(
		unmappedFormats(["openai", "kimi", "step", "gemini-level", undefined]),
		["gemini-level", "kimi", "step"],
	);
});
