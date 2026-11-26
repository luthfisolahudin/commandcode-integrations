import assert from "node:assert/strict";
import { test } from "node:test";

import { validateQuotaAccount, validateQuotaResponse, type HttpQuotaResponse } from "../src/index.ts";

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
