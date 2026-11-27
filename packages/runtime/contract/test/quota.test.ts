import assert from "node:assert/strict";
import { test } from "node:test";

import {
	QUOTA_LABEL_SEPARATOR,
	parseQuotaResetAt,
	quotaWindowLabel,
	validateQuotaAccount,
	validateQuotaResponse,
	type HttpQuotaResponse,
} from "../src/index.ts";

function validResponse(): HttpQuotaResponse {
	return {
		version: 1,
		accounts: [
			{
				id: "acc-1",
				label: "Account 1",
				providerInstanceId: "opencode",
				windows: [
					{
						id: "5h",
						kind: "session",
						label: "5-hour limit",
						usedPercent: 25,
						resetsAt: "2026-11-26T15:00:00.000Z",
					},
				],
			},
		],
	};
}

test("validateQuotaResponse accepts a valid T3 Code HttpQuotaResponse", () => {
	assert.doesNotThrow(() => validateQuotaResponse(validResponse()));
});

test("validateQuotaResponse rejects unsupported versions", () => {
	assert.throws(() => validateQuotaResponse({ ...validResponse(), version: 2 as never }), /version/);
});

test("validateQuotaAccount rejects empty ids, invalid kinds, and out-of-range percentages", () => {
	const base = validResponse().accounts[0]!;
	assert.throws(() => validateQuotaAccount({ ...base, id: " " }), /id/);
	assert.throws(
		() => validateQuotaAccount({ ...base, windows: [{ ...base.windows[0]!, kind: "daily" as never }] }),
		/kind/,
	);
	assert.throws(
		() => validateQuotaAccount({ ...base, windows: [{ ...base.windows[0]!, usedPercent: 101 }] }),
		/usedPercent/,
	);
	assert.throws(
		() => validateQuotaAccount({ ...base, windows: [{ ...base.windows[0]!, usedPercent: -1 }] }),
		/usedPercent/,
	);
	assert.throws(
		() => validateQuotaAccount({ ...base, windows: [{ ...base.windows[0]!, resetsAt: "not-a-date" }] }),
		/resetsAt/,
	);
});

test("validateQuotaWindow accepts absolute amounts and rejects unusable ones", () => {
	const base = validResponse().accounts[0]!;
	const window = base.windows[0]!;

	assert.doesNotThrow(() => validateQuotaAccount({ ...base, windows: [{ ...window, used: 3, limit: 12 }] }));
	assert.doesNotThrow(() => validateQuotaAccount({ ...base, windows: [{ ...window, used: 0, limit: 0 }] }));
	assert.throws(() => validateQuotaAccount({ ...base, windows: [{ ...window, used: -1 }] }), /used/);
	assert.throws(() => validateQuotaAccount({ ...base, windows: [{ ...window, limit: -1 }] }), /limit/);
	assert.throws(() => validateQuotaAccount({ ...base, windows: [{ ...window, used: Number.NaN }] }), /used/);
	assert.throws(
		() => validateQuotaAccount({ ...base, windows: [{ ...window, limit: Number.POSITIVE_INFINITY }] }),
		/limit/,
	);
});

test("parseQuotaResetAt normalises every shape a vendor sends", () => {
	const iso = "2026-11-26T15:00:00.000Z";
	const cases: [string, unknown, string | undefined][] = [
		["epoch seconds", 1_800_000_000, "2027-01-15T08:00:00.000Z"],
		["epoch milliseconds", 1_800_000_000_000, "2027-01-15T08:00:00.000Z"],
		["numeric string in seconds", "1800000000", "2027-01-15T08:00:00.000Z"],
		["numeric string in milliseconds", "1800000000000", "2027-01-15T08:00:00.000Z"],
		["ISO string", iso, iso],
		["date string without a zone", "2026-11-26T15:00:00", new Date("2026-11-26T15:00:00").toISOString()],
		["zero", 0, undefined],
		["numeric string zero", "0", undefined],
		["negative epoch", -1_800_000_000, undefined],
		["NaN", Number.NaN, undefined],
		["numeric string NaN", "NaN", undefined],
		["empty string", "", undefined],
		["whitespace", "   ", undefined],
		["garbage", "not-a-date", undefined],
		["null", null, undefined],
		["undefined", undefined, undefined],
		["boolean", true, undefined],
	];

	for (const [name, input, expected] of cases) {
		assert.equal(parseQuotaResetAt(input), expected, name);
	}
});

test("parseQuotaResetAt treats the 1e12 boundary as milliseconds", () => {
	// Exactly 1e12 is milliseconds; just below it is read as seconds, which lands
	// far in the future rather than in 2001. The boundary is the documented rule.
	assert.equal(parseQuotaResetAt(1_000_000_000_000), "2001-09-09T01:46:40.000Z");
	assert.equal(parseQuotaResetAt(1_000_000_000_001), "2001-09-09T01:46:40.001Z");
	assert.ok(!parseQuotaResetAt(999_999_999_999)?.startsWith("2001-"));
});

test("quotaWindowLabel names the source with one U+00B7 separator", () => {
	assert.equal(QUOTA_LABEL_SEPARATOR, "\u00b7");
	assert.equal(quotaWindowLabel("Session", "CommandCode"), "Session \u00b7 CommandCode");
	assert.equal(quotaWindowLabel("Weekly", "9Router"), "Weekly \u00b7 9Router");
	assert.equal(
		quotaWindowLabel("Session", "Antigravity", "dallasscorpio67"),
		"Session \u00b7 Antigravity (dallasscorpio67)",
	);
	assert.equal(quotaWindowLabel("Monthly", "Command Code", "GOAT \u00b7 me@example.test"), "Monthly \u00b7 Command Code (GOAT \u00b7 me@example.test)");
});

test("quotaWindowLabel keeps single spaces around the separator", () => {
	const label = quotaWindowLabel("Session", "CommandCode");
	assert.ok(label.includes(" \u00b7 "), "separator is surrounded by single spaces");
	assert.ok(!label.includes("\u00b7\u00b7"), "separator is never doubled");
	assert.equal(label.split(" \u00b7 ").length, 2);
});

test("quotaWindowLabel ignores a blank detail", () => {
	assert.equal(quotaWindowLabel("Session", "CommandCode", "   "), "Session \u00b7 CommandCode");
	assert.equal(quotaWindowLabel("Session", "CommandCode", ""), "Session \u00b7 CommandCode");
});
