import assert from "node:assert/strict";
import { test } from "node:test";

import { buildModelIndex, modelKey, normalizeModelKey } from "../src/index.ts";

function catalog(): unknown {
	return {
		first: { models: { "gpt-5.4": { limit: { context: 400_000, output: 32_000 } } } },
		second: { models: { "gpt-5.4": { limit: { context: 1_050_000, output: 128_000 } } } },
		third: { models: { "gpt-5.4": { limit: { context: 1_050_000, output: 64_000 } } } },
		// a clipped copy with its own output cap must not leak into the winner
		fourth: { models: { "gpt-5.4": { limit: { context: 400_000, output: 999_999 } } } },
	};
}

test("the majority window wins, not the first seen", () => {
	const index = buildModelIndex(catalog());
	const metadata = index.get("gpt-5.4");
	assert.equal(metadata?.contextWindow, 1_050_000);
	assert.equal(metadata?.maxOutput, 128_000);
});

test("output caps are counted only for the winning window", () => {
	const index = buildModelIndex({
		a: { models: { m: { limit: { context: 100_000, output: 8_000 } } } },
		b: { models: { m: { limit: { context: 200_000, output: 4_000 } } } },
		c: { models: { m: { limit: { context: 200_000, output: 4_000 } } } },
	});
	assert.equal(index.get("m")?.contextWindow, 200_000);
	assert.equal(index.get("m")?.maxOutput, 4_000);
});

test("ties go to the larger limit", () => {
	const index = buildModelIndex({
		a: { models: { m: { limit: { context: 100_000, output: 1_000 } } } },
		b: { models: { m: { limit: { context: 200_000, output: 2_000 } } } },
	});
	assert.equal(index.get("m")?.contextWindow, 200_000);
});

test("gateway prefixes and free tags still resolve", () => {
	const index = buildModelIndex({
		a: { models: { "vendor/kimi-k3": { limit: { context: 1_000_000, output: 131_072 } } } },
		b: { models: { "kimi-k3:free": { limit: { context: 1_000_000, output: 131_072 } } } },
	});
	assert.equal(index.get("kimi-k3")?.contextWindow, 1_000_000);
	assert.equal(modelKey("CommandCode/MiniMaxAI/MiniMax-M3"), "minimax-m3");
	assert.equal(normalizeModelKey("Kimi-K3-20260101"), "kimi-k3");
});

test("modalities, reasoning and tools come from the declared flags", () => {
	const index = buildModelIndex({
		a: {
			models: {
				m: { attachment: true, reasoning: true, tool_call: true, modalities: { input: ["text", "image"] } },
			},
		},
		b: { models: { m: { attachment: false, reasoning: false, tool_call: false } } },
		c: { models: { m: { attachment: false, reasoning: false, tool_call: false } } },
	});
	const metadata = index.get("m");
	assert.equal(metadata?.image, false, "two of three say no image");
	assert.equal(metadata?.reasoning, false);
	assert.equal(metadata?.tools, false);
});

test("capability ties resolve to the capable side, because a dropped input is silent", () => {
	const index = buildModelIndex({
		a: { models: { m: { attachment: true } } },
		b: { models: { m: { attachment: false } } },
	});
	assert.equal(index.get("m")?.image, true);
});

test("pricing is read in USD per 1M and kept per field", () => {
	const index = buildModelIndex({
		a: { models: { m: { cost: { input: 3, output: 15, cache_read: 0.3 } } } },
		b: { models: { m: { cost: { input: 3, output: 15, cache_read: 0.3 } } } },
	});
	assert.deepEqual(index.get("m")?.cost, { input: 3, output: 15, cacheRead: 0.3 });
});

test("entries without limits or cost still contribute capability hints", () => {
	const index = buildModelIndex({ a: { models: { m: { reasoning: true } } } });
	assert.equal(index.size, 1);
	assert.equal(index.get("m")?.reasoning, true);
	assert.equal(index.get("m")?.cost, undefined);
});

test("an empty model record contributes nothing", () => {
	const index = buildModelIndex({ a: { models: { m: {}, n: "nope" } } });
	assert.equal(index.size, 0);
	assert.equal(index.get("m"), undefined);
});

test("a non-object catalog yields an empty index instead of throwing", () => {
	assert.equal(buildModelIndex(null).size, 0);
	assert.equal(buildModelIndex([]).size, 0);
});

test("declared reasoning options become effort levels and a toggle flag", () => {
	const index = buildModelIndex({
		a: {
			models: {
				"deepseek-v4-pro": {
					reasoning: true,
					reasoning_options: [{ type: "toggle" }, { type: "effort", values: ["high", "max"] }],
				},
				"glm-5.2": { reasoning: true, reasoning_options: [{ type: "effort", values: ["none", "high"] }] },
			},
		},
	});
	assert.deepEqual(index.get("deepseek-v4-pro")?.efforts, ["high", "max"]);
	assert.equal(index.get("deepseek-v4-pro")?.toggle, true);
	assert.deepEqual(index.get("glm-5.2")?.efforts, ["none", "high"]);
	assert.equal(index.get("glm-5.2")?.toggle, undefined);
});
