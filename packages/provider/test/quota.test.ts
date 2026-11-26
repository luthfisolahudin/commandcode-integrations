import assert from "node:assert/strict";
import { test } from "node:test";

import { validateQuotaResponse, type HookContext } from "@luthfisolahudin/ai-integrations-contract";

import { readCommandCodeQuota } from "../src/quota.ts";

function makeContext(apiKey = "user_test"): HookContext {
	return {
		baseUrl: "https://api.commandcode.ai/provider/v1",
		apiKey,
		headers: { Accept: "application/json", Authorization: `Bearer ${apiKey}` },
		signal: AbortSignal.timeout(5_000),
	};
}

function jsonResponse(body: unknown, status = 200): Response {
	return new Response(JSON.stringify(body), {
		status,
		headers: { "Content-Type": "application/json" },
	});
}

test("readCommandCodeQuota maps credits and 5h/weekly windows into HttpQuotaAccount", async () => {
	const seen: { url: string; headers: unknown }[] = [];
	const accounts = await readCommandCodeQuota(makeContext(), async (input, init) => {
		const url = String(input);
		seen.push({ url, headers: init?.headers });
		if (url.includes("/alpha/whoami")) {
			return jsonResponse({
				user: { name: "Luthfi", email: "luthfi@example.test" },
				org: { id: "org_1", name: "personal" },
			});
		}
		if (url.includes("/alpha/billing/credits")) {
			return jsonResponse({
				credits: { monthlyCredits: 12.5, purchasedCredits: 1, freeCredits: 0.5 },
				windowLimits: {
					fiveHour: { used: 2, cap: 10, resetAt: 1792680000000 },
					weekly: { used: 20, cap: 70, resetAt: 1792766400000 },
				},
			});
		}
		if (url.includes("/alpha/billing/subscriptions")) {
			return jsonResponse({
				data: { planId: "individual-goat", currentPeriodEnd: "2026-10-01T00:00:00.000Z" },
			});
		}
		return jsonResponse({}, 404);
	});

	assert.equal(accounts.length, 1);
	const account = accounts[0]!;
	assert.equal(account.label, "Command Code (GOAT · luthfi@example.test)");
	assert.deepEqual(account.windows, [
		{
			id: "monthly",
			kind: "monthly",
			label: "Credits",
			usedPercent: 80,
			resetsAt: "2026-10-01T00:00:00.000Z",
		},
		{
			id: "5h",
			kind: "session",
			label: "Session (5h)",
			usedPercent: 20,
			resetsAt: new Date(1792680000000).toISOString(),
		},
		{
			id: "weekly",
			kind: "weekly",
			label: "Weekly",
			usedPercent: 28.57,
			resetsAt: new Date(1792766400000).toISOString(),
		},
	]);
	assert.doesNotThrow(() => validateQuotaResponse({ version: 1, accounts }));
	assert.ok(seen.some((entry) => entry.url.includes("orgId=org_1")));
});

test("readCommandCodeQuota omits resetsAt when resetAt is 0 and throws on 401", async () => {
	const accounts = await readCommandCodeQuota(makeContext(), async (input) => {
		const url = String(input);
		if (url.includes("/alpha/whoami")) return jsonResponse({ user: {}, org: null });
		if (url.includes("/alpha/billing/credits")) {
			return jsonResponse({
				credits: { monthlyCredits: 6.39, purchasedCredits: 0, freeCredits: 0 },
				windowLimits: { fiveHour: { used: 0, cap: 3, resetAt: 0 } },
			});
		}
		if (url.includes("/alpha/billing/subscriptions")) {
			return jsonResponse({ data: { planId: "individual-go-v1", currentPeriodEnd: "2026-10-29T00:00:00.000Z" } });
		}
		return jsonResponse({}, 404);
	});

	assert.equal(accounts[0]!.windows[1]!.resetsAt, undefined);
	assert.equal(accounts[0]!.windows[1]!.usedPercent, 0);

	await assert.rejects(
		() => readCommandCodeQuota(makeContext("bad"), async () => jsonResponse({ error: "unauthorized" }, 401)),
		/401/,
	);
});
