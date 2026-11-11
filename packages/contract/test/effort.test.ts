import assert from "node:assert/strict";
import { test } from "node:test";

import { declaredEffortMenu, effortMenu, hasEffortMenu } from "../src/index.ts";

test("no measurement means no menu", () => {
	assert.equal(effortMenu({}), undefined);
	assert.equal(effortMenu({ wireEffort: "  " }), undefined);
	assert.equal(hasEffortMenu(undefined), false);
});

test("client max carries the measured wire value and other levels are hidden", () => {
	const menu = effortMenu({ wireEffort: "xhigh" });
	assert.deepEqual(menu, {
		off: null,
		minimal: null,
		low: null,
		medium: null,
		high: null,
		xhigh: null,
		max: "xhigh",
	});
	assert.equal(hasEffortMenu(menu), true);
});

test("a non-disableable model also hides off", () => {
	const menu = effortMenu({ wireEffort: "max", canDisable: false });
	assert.equal(menu?.off, null);
	assert.equal(menu?.max, "max");
});

test("measured aliases can be exposed explicitly", () => {
	const menu = effortMenu({ wireEffort: "high", levels: ["high", "max"] });
	assert.equal(menu?.high, "high");
	assert.equal(menu?.max, "high");
});

test("declared levels map to themselves, and none becomes the disabled state", () => {
	const menu = declaredEffortMenu(["low", "medium", "high"], true);
	assert.deepEqual(menu, {
		off: "off",
		minimal: null,
		low: "low",
		medium: "medium",
		high: "high",
		xhigh: null,
		max: null,
	});
});

test("an explicit none in the declaration disables off even without canDisable", () => {
	const menu = declaredEffortMenu(["none", "high"], undefined);
	assert.equal(menu?.off, "none");
	assert.equal(menu?.high, "high");
});

test("a non-disableable model with no none declares off hidden", () => {
	const menu = declaredEffortMenu(["high"], false);
	assert.equal(menu?.off, null);
	assert.equal(menu?.high, "high");
});

test("unrecognised declarations yield no menu instead of a guess", () => {
	assert.equal(declaredEffortMenu([], true), undefined);
	assert.equal(declaredEffortMenu(["turbo", "warp"], true), undefined);
});
