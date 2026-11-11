import assert from "node:assert/strict";
import { test } from "node:test";

import {
	capabilityView,
	inputModalities,
	outputModalities,
	positiveFinite,
	readPath,
} from "../src/index.ts";

const FIELDS = {
	contextWindow: ["capabilities.contextWindow", "context_length"],
	maxOutput: ["capabilities.maxOutput", "max_completion_tokens"],
	vision: ["capabilities.vision", "supports_vision"],
	audioInput: ["capabilities.audioInput"],
	videoInput: ["capabilities.videoInput"],
	pdf: ["capabilities.pdf"],
	imageOutput: ["capabilities.imageOutput"],
	audioOutput: ["capabilities.audioOutput"],
	tools: ["capabilities.tools"],
	reasoning: ["capabilities.reasoning", "supports_reasoning"],
	thinkingFormat: ["capabilities.thinkingFormat"],
	thinkingCanDisable: ["capabilities.thinkingCanDisable"],
	availability: ["status"],
	inputModalities: ["input_modalities"],
	displayName: ["name"],
};

test("readPath walks dotted paths and rejects arrays and misses", () => {
	assert.equal(readPath({ a: { b: { c: 1 } } }, "a.b.c"), 1);
	assert.equal(readPath({ a: [{ b: 1 }] }, "a.b"), undefined);
	assert.equal(readPath({}, "a.b"), undefined);
	assert.equal(readPath({ a: null }, "a.b"), undefined);
});

test("positiveFinite rejects zero, NaN, Infinity, strings", () => {
	assert.equal(positiveFinite(5), 5);
	assert.equal(positiveFinite(0), undefined);
	assert.equal(positiveFinite(-1), undefined);
	assert.equal(positiveFinite(Number.NaN), undefined);
	assert.equal(positiveFinite(Number.POSITIVE_INFINITY), undefined);
	assert.equal(positiveFinite("5"), undefined);
});

test("capabilities use strict true: an omitted flag is false, never a guess", () => {
	const view = capabilityView({ id: "m" }, FIELDS);
	assert.equal(view.vision, false);
	assert.equal(view.reasoning, false);
	assert.equal(view.tools, undefined);
	assert.deepEqual(inputModalities(view), ["text"]);
});

test("capabilities read the first matching alias and both flag shapes", () => {
	const view = capabilityView(
		{
			id: "claude-x",
			capabilities: { vision: true, tools: true, reasoning: true, thinkingFormat: "openai" },
			context_length: 200_000,
			max_completion_tokens: 8_192,
		},
		FIELDS,
	);
	assert.equal(view.vision, true);
	assert.equal(view.tools, true);
	assert.equal(view.reasoning, true);
	assert.equal(view.thinkingFormat, "openai");
	assert.equal(view.contextWindow, 200_000);
	assert.equal(view.maxOutput, 8_192);
});

test("gutsai-shaped flags are read from top-level fields", () => {
	const view = capabilityView(
		{
			id: "gpt-x",
			supports_vision: true,
			supports_reasoning: true,
			input_modalities: ["text", "image", "file"],
			status: "offline",
			price_per_1m: 500,
		},
		FIELDS,
	);
	assert.equal(view.vision, true);
	assert.equal(view.reasoning, true);
	assert.equal(view.availability, "offline");
	assert.deepEqual(inputModalities(view), ["text", "image", "pdf"]);
});

test("declare-only input modalities count even without a vision flag", () => {
	const view = capabilityView({ id: "m", input_modalities: ["image"] }, FIELDS);
	assert.deepEqual(inputModalities(view), ["text", "image"]);
});

test("audio, video, and pdf are only added when declared", () => {
	const view = capabilityView(
		{ id: "m", capabilities: { audioInput: true, videoInput: true, pdf: true } },
		FIELDS,
	);
	assert.deepEqual(inputModalities(view), ["text", "image", "pdf", "audio", "video"].filter((m) => m !== "image"));
});

test("image and audio output are reported separately from input", () => {
	const view = capabilityView({ id: "m", capabilities: { imageOutput: true, audioOutput: true } }, FIELDS);
	assert.deepEqual(outputModalities(view), ["text", "image", "audio"]);
});
