import assert from "node:assert/strict";
import { test } from "node:test";

import {
	PACK_SCHEMA_VERSION,
	definePack,
	type HttpQuotaAccount,
	type HttpQuotaWindow,
	type Pack,
} from "@luthfisolahudin/ai-integrations-contract";

import { aggregateQuotaAccounts, collectQuota, fetchQuota, handleQuotaRequest } from "../src/index.ts";

function makeQuotaPack(id: string, quota: NonNullable<Pack["hooks"]>["quota"]): Pack {
	return definePack({
		schemaVersion: PACK_SCHEMA_VERSION,
		id,
		name: id,
		baseUrl: "https://api.example.test/v1",
		auth: { kind: "bearer", apiKey: "test-key" },
		discovery: { path: "/models" },
		hooks: quota === undefined ? undefined : { quota },
	});
}

function antigravity(email: string, window: Partial<HttpQuotaWindow> = {}): HttpQuotaAccount {
	return {
		id: `9router-antigravity-${email}`,
		label: `Antigravity (${email})`,
		windows: [
			{
				id: "gemini_session",
				kind: "session",
				label: "Gemini Session · Antigravity",
				usedPercent: 0,
				...window,
			},
		],
	};
}

test("fetchQuota throws when pack has no quota hook", async () => {
	const pack = makeQuotaPack("plain", undefined);
	await assert.rejects(() => fetchQuota(pack), /does not implement quota/);
});

test("fetchQuota attaches providerInstanceId fallback, aggregates, and validates accounts", async () => {
	let seenAuth = "";
	const pack = makeQuotaPack("cc", async (context) => {
		seenAuth = context.headers["Authorization"] ?? "";
		return [
			{
				id: "acc-1",
				label: "Test Account",
				windows: [{ id: "5h", kind: "session", label: "5-hour limit", usedPercent: 40 }],
			},
		];
	});

	const result = await fetchQuota(pack, { providerInstanceId: "opencode" });
	assert.equal(seenAuth, "Bearer test-key");
	assert.deepEqual(result.response, {
		version: 1,
		accounts: [
			{
				id: "quota-test-account",
				label: "Test Account",
				providerInstanceId: "opencode",
				windows: [{ id: "5h", kind: "session", label: "5-hour limit", usedPercent: 40 }],
			},
		],
	});
});

test("handleQuotaRequest enforces bearer token, method, and path", async () => {
	const pack = makeQuotaPack("cc", async () => [
		{ id: "acc-1", label: "CC", windows: [{ id: "m", kind: "monthly", label: "Credits", usedPercent: 10 }] },
	]);
	const options = { packs: [pack], token: "secret-token" };

	const post = await handleQuotaRequest({ method: "POST", path: "/" }, options);
	assert.equal(post.status, 405);

	const unauth = await handleQuotaRequest({ method: "GET", path: "/" }, options);
	assert.equal(unauth.status, 401);

	const notFound = await handleQuotaRequest({ method: "GET", path: "/unknown", authorization: "Bearer secret-token" }, options);
	assert.equal(notFound.status, 404);

	const health = await handleQuotaRequest({ method: "GET", path: "/health" }, options);
	assert.equal(health.status, 200);

	const ok = await handleQuotaRequest({ method: "GET", path: "/quota", authorization: "Bearer secret-token" }, options);
	assert.equal(ok.status, 200);
	assert.deepEqual(JSON.parse(ok.body), {
		version: 1,
		accounts: [{ id: "quota-cc", label: "CC", windows: [{ id: "m", kind: "monthly", label: "Credits", usedPercent: 10 }] }],
	});
});

test("handleQuotaRequest returns 502 when all quota packs fail and 200 when one succeeds", async () => {
	const failing = makeQuotaPack("bad", async () => {
		throw new Error("upstream down");
	});
	const working = makeQuotaPack("good", async () => [
		{ id: "acc-2", label: "Good", windows: [] },
	]);

	const allFail = await handleQuotaRequest({ method: "GET", path: "/" }, { packs: [failing] });
	assert.equal(allFail.status, 502);

	const partial = await collectQuota([failing, working]);
	assert.equal(partial.errors.length, 1);
	assert.equal(partial.response.accounts.length, 1);
});

test("three accounts of one product collapse into one provider-level account", () => {
	const accounts = aggregateQuotaAccounts([
		antigravity("a@example.test"),
		antigravity("b@example.test"),
		antigravity("c@example.test"),
	]);

	assert.equal(accounts.length, 1);
	assert.equal(accounts[0]!.id, "quota-antigravity");
	assert.equal(accounts[0]!.label, "Antigravity");
});

test("accounts of different products stay separate", () => {
	const accounts = aggregateQuotaAccounts([
		antigravity("a@example.test"),
		{ id: "codex-1", label: "OpenAI Codex (plus)", windows: [] },
	]);

	assert.deepEqual(accounts.map((account) => account.id), ["quota-antigravity", "quota-openai-codex"]);
});

test("the pool id is stable across runs and input order", () => {
	const forward = aggregateQuotaAccounts([antigravity("a@example.test"), antigravity("b@example.test")]);
	const reverse = aggregateQuotaAccounts([antigravity("b@example.test"), antigravity("a@example.test")]);
	assert.deepEqual(forward, reverse);
});

test("a nested parenthetical in the account detail does not truncate the provider name", () => {
	const accounts = aggregateQuotaAccounts([
		{ id: "1", label: "CodeBuddy CN (Guts Store (1))", windows: [] },
		{ id: "2", label: "CodeBuddy CN (Guts Store (2))", windows: [] },
	]);

	assert.equal(accounts.length, 1);
	assert.equal(accounts[0]!.label, "CodeBuddy CN");
	assert.equal(accounts[0]!.id, "quota-codebuddy-cn");
});

test("window ids dedupe across accounts instead of repeating", () => {
	const accounts = aggregateQuotaAccounts([
		{
			id: "a",
			label: "Pool (a)",
			windows: [
				{ id: "gemini_session", kind: "session", label: "Gemini Session · Pool", usedPercent: 10 },
				{ id: "claude_session", kind: "session", label: "Claude Session · Pool", usedPercent: 20 },
			],
		},
		{
			id: "b",
			label: "Pool (b)",
			windows: [{ id: "gemini_session", kind: "session", label: "Gemini Session · Pool", usedPercent: 30 }],
		},
	]);

	assert.deepEqual(accounts[0]!.windows.map((window) => window.id), ["claude_session", "gemini_session"]);
});

test("all-absolute contributors are weighted, so a fully spent free account beside a 10x account reads 8.33%", () => {
	const accounts = aggregateQuotaAccounts([
		antigravity("spent@example.test", { id: "gemini_session", kind: "session", usedPercent: 100, used: 100, limit: 100 }),
		antigravity("large@example.test", { id: "gemini_session", kind: "session", usedPercent: 0, used: 0, limit: 1000 }),
		antigravity("fresh@example.test", { id: "gemini_session", kind: "session", usedPercent: 0, used: 0, limit: 100 }),
	]);

	const window = accounts[0]!.windows[0]!;
	// A mean would say 33.33%, and a naive sum would say 100%: both are wrong.
	assert.equal(window.usedPercent, 8.33);
	assert.equal(window.label, "Gemini Session · Antigravity");
});

test("percentage-only contributors fall back to the mean and still emit an account", () => {
	const accounts = aggregateQuotaAccounts([
		antigravity("a@example.test", { usedPercent: 30 }),
		antigravity("b@example.test", { usedPercent: 60 }),
	]);

	assert.equal(accounts.length, 1);
	assert.equal(accounts[0]!.windows.length, 1);
	assert.equal(accounts[0]!.windows[0]!.usedPercent, 45);
	assert.equal(accounts[0]!.windows[0]!.label, "Gemini Session · Antigravity");
});

test("a mixed pool weights the absolute contributors and marks the label approximate", () => {
	const accounts = aggregateQuotaAccounts([
		antigravity("absolute@example.test", { usedPercent: 10, used: 10, limit: 100 }),
		antigravity("percentage@example.test", { usedPercent: 90 }),
	]);

	const window = accounts[0]!.windows[0]!;
	// The absolute contributor is 10/100; the percentage-only one cannot be
	// weighted, so the pooled figure follows the absolutes and reads approximate.
	assert.equal(window.usedPercent, 10);
	assert.ok(window.label.endsWith("~"), "a mixed pool must read as approximate");
});

test("`used` and `limit` never reach the aggregated output", () => {
	const accounts = aggregateQuotaAccounts([
		antigravity("a@example.test", { used: 10, limit: 100 }),
		antigravity("b@example.test", { used: 20, limit: 100 }),
	]);

	for (const window of accounts[0]!.windows) {
		assert.deepEqual(Object.keys(window).sort(), ["id", "kind", "label", "usedPercent"]);
	}

	const served = JSON.stringify(accounts);
	assert.ok(!served.includes("\"used\""), "used must not be serialised");
	assert.ok(!served.includes("\"limit\""), "limit must not be serialised");
});

test("the earliest reset among active contributors wins and an idle contributor is ignored", () => {
	const accounts = aggregateQuotaAccounts([
		antigravity("idle@example.test", {
			used: 0,
			limit: 100,
			resetsAt: "2020-01-01T00:00:00.000Z",
		}),
		antigravity("busy@example.test", {
			usedPercent: 10,
			used: 10,
			limit: 100,
			resetsAt: "2027-01-01T00:00:00.000Z",
		}),
		antigravity("busiest@example.test", {
			usedPercent: 90,
			used: 90,
			limit: 100,
			resetsAt: "2026-12-01T00:00:00.000Z",
		}),
	]);

	assert.equal(accounts[0]!.windows[0]!.resetsAt, "2026-12-01T00:00:00.000Z");
});

test("when no contributor reports used, every finite reset is eligible", () => {
	const accounts = aggregateQuotaAccounts([
		antigravity("a@example.test", { usedPercent: 0, resetsAt: "2027-01-01T00:00:00.000Z" }),
		antigravity("b@example.test", { usedPercent: 0, resetsAt: "2026-12-01T00:00:00.000Z" }),
	]);

	assert.equal(accounts[0]!.windows[0]!.resetsAt, "2026-12-01T00:00:00.000Z");
});

test("resetsAt is omitted when no contributor reports one", () => {
	const accounts = aggregateQuotaAccounts([
		antigravity("a@example.test"),
		antigravity("b@example.test"),
	]);

	assert.equal(accounts[0]!.windows[0]!.resetsAt, undefined);
});

test("providerInstanceId is kept when every contributor agrees and dropped when they disagree", () => {
	const agree = aggregateQuotaAccounts([
		{ ...antigravity("a@example.test"), providerInstanceId: "opencode" },
		{ ...antigravity("b@example.test"), providerInstanceId: "opencode" },
	]);
	assert.equal(agree[0]!.providerInstanceId, "opencode");

	const disagree = aggregateQuotaAccounts([
		{ ...antigravity("a@example.test"), providerInstanceId: "opencode" },
		{ ...antigravity("b@example.test"), providerInstanceId: "pi" },
	]);
	assert.equal(disagree[0]!.providerInstanceId, undefined);
	assert.ok(!("providerInstanceId" in disagree[0]!));
});

test("windows are ordered session, weekly, monthly, other, then by id", () => {
	const accounts = aggregateQuotaAccounts([
		{
			id: "a",
			label: "Pool (a)",
			windows: [
				{ id: "z_other", kind: "other", label: "Other · Pool", usedPercent: 1 },
				{ id: "m", kind: "monthly", label: "Monthly · Pool", usedPercent: 1 },
				{ id: "w", kind: "weekly", label: "Weekly · Pool", usedPercent: 1 },
				{ id: "b_session", kind: "session", label: "Session · Pool", usedPercent: 1 },
				{ id: "a_session", kind: "session", label: "Session · Pool", usedPercent: 1 },
			],
		},
	]);

	assert.deepEqual(accounts[0]!.windows.map((window) => window.id), [
		"a_session",
		"b_session",
		"w",
		"m",
		"z_other",
	]);
});

test("dropUnsummable drops only the approximate windows", () => {
	const accounts = [
		antigravity("absolute@example.test", { id: "mixed", kind: "session", used: 10, limit: 100 }),
		antigravity("percentage@example.test", { id: "mixed", kind: "session", usedPercent: 50 }),
		antigravity("a@example.test", { id: "exact", kind: "weekly", used: 25, limit: 100 }),
		antigravity("b@example.test", { id: "exact", kind: "weekly", used: 25, limit: 100 }),
		antigravity("c@example.test", { id: "mean", kind: "monthly", usedPercent: 40 }),
		antigravity("d@example.test", { id: "mean", kind: "monthly", usedPercent: 60 }),
	];

	const kept = aggregateQuotaAccounts(accounts);
	// `mixed` is a session window, so it sorts ahead of the weekly and monthly ones.
	assert.deepEqual(kept[0]!.windows.map((window) => window.id), ["mixed", "exact", "mean"]);

	const dropped = aggregateQuotaAccounts(accounts, { dropUnsummable: true });
	// `mixed` (session) is dropped; the exact and mean windows survive.
	assert.deepEqual(dropped[0]!.windows.map((window) => window.id), ["exact", "mean"]);
});

test("an empty account list aggregates to nothing", () => {
	assert.deepEqual(aggregateQuotaAccounts([]), []);
});
