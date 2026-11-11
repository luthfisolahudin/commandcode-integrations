import assert from "node:assert/strict";
import { test } from "node:test";

import { decideEffort, median, type ProbeSample } from "../src/index.ts";

function samples(signals: Record<string, number | undefined>, status = 200): ProbeSample[] {
	return Object.entries(signals).map(([level, reasoningTokens]) => ({
		level,
		status,
		finishReason: "stop",
		...(reasoningTokens === undefined ? {} : { reasoningTokens }),
	}));
}

test("median handles odd and even counts", () => {
	assert.equal(median([3]), 3);
	assert.equal(median([1, 3]), 2);
	assert.equal(median([3, 1, 2]), 2);
	assert.equal(median([]), undefined);
});

test("cosmoshub deepseek-v4.1-flash 11/10/11 is no observable difference", () => {
	const verdict = decideEffort(samples({ minimal: 11, low: 10, max: 11 }));
	assert.equal(verdict.verdict, "no-observable-difference");
});

test("gutsai deepseek-v4.1-flash minimal 7 vs max 0 is an inversion", () => {
	const verdict = decideEffort(samples({ minimal: 7, max: 0 }));
	assert.equal(verdict.verdict, "inverted");
	if (verdict.verdict === "inverted") assert.equal(verdict.level, "minimal");
});

test("a monotonic increase maps the highest level", () => {
	const verdict = decideEffort(samples({ low: 15, high: 40, max: 90 }));
	assert.equal(verdict.verdict, "mapped");
	if (verdict.verdict === "mapped") assert.equal(verdict.wire, "max");
});

test("every level rejected means unsupported, not unmeasured", () => {
	const verdict = decideEffort(samples({ low: undefined, max: undefined }, 400));
	assert.equal(verdict.verdict, "unsupported");
});

test("a large noise floor collapses small differences", () => {
	const verdict = decideEffort(samples({ low: 10, max: 14 }), { noiseFloor: 10 });
	assert.equal(verdict.verdict, "no-observable-difference");
});

test("three samples per level use the median, not the mean", () => {
	const samplesWithNoise: ProbeSample[] = [
		{ level: "max", status: 200, reasoningTokens: 90 },
		{ level: "max", status: 200, reasoningTokens: 100 },
		{ level: "max", status: 200, reasoningTokens: 400 },
		{ level: "low", status: 200, reasoningTokens: 10 },
		{ level: "low", status: 200, reasoningTokens: 12 },
		{ level: "low", status: 200, reasoningTokens: 11 },
	];
	const verdict = decideEffort(samplesWithNoise);
	assert.equal(verdict.verdict, "mapped");
	if (verdict.verdict === "mapped") assert.equal(verdict.signals["max"], 100);
});

test("a billing or quota rejection makes the probe inconclusive, never 'no difference'", () => {
	const verdict = decideEffort([
		{ level: "minimal", status: 200, reasoningTokens: 11 },
		{ level: "low", status: 200, reasoningTokens: 11 },
		{ level: "max", status: 402 },
	]);
	assert.equal(verdict.verdict, "inconclusive");
	if (verdict.verdict === "inconclusive") {
		assert.equal(verdict.reason, "blocked");
		assert.deepEqual(verdict.statuses, { max: 402 });
	}
});

test("a validation rejection is a capability answer, so the rest still counts", () => {
	const verdict = decideEffort([
		{ level: "low", status: 200, reasoningTokens: 10 },
		{ level: "high", status: 200, reasoningTokens: 40 },
		{ level: "max", status: 400 },
	]);
	assert.equal(verdict.verdict, "mapped");
});

test("one accepted level is not enough to compare", () => {
	const verdict = decideEffort([
		{ level: "low", status: 200, reasoningTokens: 10 },
		{ level: "max", status: 500 },
	]);
	assert.equal(verdict.verdict, "inconclusive");

	const onlyOne = decideEffort([
		{ level: "low", status: 200, reasoningTokens: 10 },
		{ level: "max", status: 400 },
	]);
	assert.equal(onlyOne.verdict, "inconclusive");
	if (onlyOne.verdict === "inconclusive") assert.equal(onlyOne.reason, "too-few-levels");
});
