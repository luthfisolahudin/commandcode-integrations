import { createHash, timingSafeEqual } from "node:crypto";

import {
	parseQuotaResetAt,
	validateQuotaResponse,
	type HookContext,
	type HttpQuotaAccount,
	type HttpQuotaResponse,
	type HttpQuotaWindow,
	type HttpQuotaWindowKind,
	type Pack,
} from "@luthfisolahudin/ai-integrations-contract";

import { authHeaders, DEFAULT_TIMEOUT_MS, resolveApiKey } from "./discover.ts";

export interface QuotaOptions {
	signal?: AbortSignal;
	apiKey?: string;
	baseUrl?: string;
	providerInstanceId?: string;
	timeoutMs?: number;
}

export interface QuotaResult {
	response: HttpQuotaResponse;
	checkedAt: number;
}

export interface QuotaHandlerOptions {
	packs: readonly Pack[];
	token?: string;
	providerInstanceId?: string;
	timeoutMs?: number;
}

export interface QuotaHttpRequest {
	method: string;
	path: string;
	authorization?: string;
}

export interface QuotaHttpReply {
	status: number;
	headers: Record<string, string>;
	body: string;
}

function sha256(value: string): Buffer {
	return createHash("sha256").update(value).digest();
}

function matchesBearer(header: string | undefined, token: string): boolean {
	if (!header || !header.startsWith("Bearer ")) return false;
	const supplied = header.slice(7).trim();
	if (supplied.length === 0) return false;
	return timingSafeEqual(sha256(supplied), sha256(token));
}

export async function fetchQuota(pack: Pack, options: QuotaOptions = {}): Promise<QuotaResult> {
	if (pack.hooks?.quota === undefined) {
		throw new Error(`${pack.id} does not implement quota reporting`);
	}
	const source: Pack = options.baseUrl === undefined ? pack : { ...pack, baseUrl: options.baseUrl };
	const apiKey = source.auth?.kind === "none" ? undefined : options.apiKey?.trim() || resolveApiKey(source);
	const timeout = AbortSignal.timeout(options.timeoutMs ?? source.discovery.timeoutMs ?? DEFAULT_TIMEOUT_MS);
	const signal = options.signal === undefined ? timeout : AbortSignal.any([timeout, options.signal]);
	const context: HookContext = {
		baseUrl: source.baseUrl.replace(/\/+$/, ""),
		...(apiKey === undefined ? {} : { apiKey }),
		headers: {
			Accept: "application/json",
			"User-Agent": source.discovery.userAgent ?? "ai-provider-integrations/0.1",
			...authHeaders(source, apiKey),
			...source.discovery.headers,
		},
		signal,
	};

	const rawAccounts = await pack.hooks.quota(context);
	const withInstance = rawAccounts.map((account) => {
		if (account.providerInstanceId !== undefined || options.providerInstanceId === undefined) {
			return account;
		}
		return { ...account, providerInstanceId: options.providerInstanceId };
	});
	// The hook speaks in upstream connections; the protocol speaks in products.
	// Aggregating here also strips the engine-internal `used`/`limit` amounts so
	// the HTTP source serves only the documented fields.
	const response: HttpQuotaResponse = { version: 1, accounts: aggregateQuotaAccounts(withInstance) };
	validateQuotaResponse(response);
	return { response, checkedAt: Date.now() };
}

const KIND_ORDER: Readonly<Record<HttpQuotaWindowKind, number>> = {
	session: 0,
	weekly: 1,
	monthly: 2,
	other: 3,
};

export interface QuotaAggregationOptions {
	/**
	 * Drop windows whose figure cannot be exact: a pool where only some
	 * contributors report absolute amounts (the `~` case). Default: `false`, so
	 * the approximate figure is shown and labelled rather than hidden. Set `true`
	 * when a consumer needs exact ratios only.
	 *
	 * A percentage-only pool is never dropped: the mean is the documented
	 * fallback, and the account must still reach the source.
	 */
	dropUnsummable?: boolean;
}

interface AbsoluteAmounts {
	used: number;
	limit: number;
}

/**
 * Folds the accounts of one product into a single pooled account.
 *
 * `usedPercent` is a share of a denominator the protocol does not otherwise
 * carry, so percentages from different accounts are not addends: three accounts
 * each at 30% are 30% of the pooled allowance, not 90%. A correct pool needs the
 * absolute amounts, which is why `HttpQuotaWindow` carries optional `used` and
 * `limit` and why a pack should report them whenever the vendor does.
 *
 * The contract, in order of preference:
 *
 * 1. every contributor reports `used`/`limit` — exact `sum(used) / sum(limit)`,
 *    which stays correct when one account has ten times another's allowance;
 * 2. no contributor does — the arithmetic mean of the percentages, exact only
 *    when the accounts share one allowance (N seats of one plan), which is the
 *    best assumption the protocol leaves available;
 * 3. only some do — the ratio over the contributors that carry absolutes, with
 *    `~` appended to the label because the percentage-only accounts cannot be
 *    weighted.
 *
 * One output account per label pool, id `quota-<provider-slug>` so it survives
 * a reconnect. Windows keep their `id`, are ordered `session`, `weekly`,
 * `monthly`, `other`, then by id, and never carry `used`/`limit`: those are
 * engine-internal, not protocol fields.
 */
export function aggregateQuotaAccounts(
	accounts: HttpQuotaAccount[],
	options: QuotaAggregationOptions = {},
): HttpQuotaAccount[] {
	if (accounts.length === 0) return [];
	const dropUnsummable = options.dropUnsummable ?? false;

	const pools = new Map<string, { label: string; accounts: HttpQuotaAccount[] }>();
	for (const account of accounts) {
		const provider = providerPortion(account.label);
		// Pooling on the slug, not the raw label, keeps casing and punctuation
		// differences from splitting one vendor into two accounts with equal ids.
		const key = slugify(provider);
		const pool = pools.get(key);
		if (pool === undefined) pools.set(key, { label: provider, accounts: [account] });
		else pool.accounts.push(account);
	}

	const aggregated: HttpQuotaAccount[] = [];
	for (const [key, pool] of pools) {
		const [only] = pool.accounts;
		if (pool.accounts.length === 1 && only !== undefined) {
			// A pool of one is not a pool: keep the source's own id and label, so a
			// single-account vendor is not silently renamed. Only the engine-internal
			// absolutes come off.
			aggregated.push({
				...only,
				windows: only.windows.map(({ used: _used, limit: _limit, ...window }) => window),
			});
			continue;
		}
		const instance = sharedInstanceId(pool.accounts);
		aggregated.push({
			id: `quota-${key}`,
			label: pool.label,
			...(instance === undefined ? {} : { providerInstanceId: instance }),
			windows: aggregateProviderWindows(pool.accounts, dropUnsummable),
		});
	}
	return aggregated.sort((left, right) => compare(left.id, right.id));
}

/**
 * `Antigravity (dallasscorpio67@gmail.com)` is the same product as its
 * parenthetical-free prefix; the detail only tells accounts apart. Scanning from
 * the end keeps a nested pair such as `CodeBuddy CN (Guts Store (1))` intact.
 */
function providerPortion(label: string): string {
	const trimmed = label.trim();
	if (!trimmed.endsWith(")")) return trimmed;
	let depth = 0;
	for (let index = trimmed.length - 1; index >= 0; index -= 1) {
		const character = trimmed[index];
		if (character === ")") depth += 1;
		else if (character === "(") {
			depth -= 1;
			if (depth !== 0) continue;
			if (index === 0 || trimmed[index - 1] !== " ") return trimmed;
			const head = trimmed.slice(0, index - 1).trim();
			return head.length === 0 ? trimmed : head;
		}
	}
	return trimmed;
}

/** Lower-cased, accent-stripped, non-alphanumerics collapsed to one hyphen. */
function slugify(value: string): string {
	const slug = value
		.normalize("NFKD")
		.toLowerCase()
		.replace(/[^\p{L}\p{N}]+/gu, "-")
		.replace(/^-+|-+$/g, "");
	return slug.length === 0 ? "account" : slug;
}

/** The one instance id every contributor agrees on, or `undefined` when they disagree or omit it. */
function sharedInstanceId(accounts: readonly HttpQuotaAccount[]): string | undefined {
	const values = new Set(accounts.map((account) => account.providerInstanceId));
	if (values.size !== 1) return undefined;
	return [...values][0];
}

/**
 * Absolute amounts, or `undefined` when the vendor published only a percentage.
 * A zero allowance cannot express a ratio, so it falls back to the percentage
 * rather than dividing by zero.
 */
function readAbsolutes(window: HttpQuotaWindow): AbsoluteAmounts | undefined {
	const used = window.used;
	const limit = window.limit;
	if (typeof used !== "number" || !Number.isFinite(used)) return undefined;
	if (typeof limit !== "number" || !Number.isFinite(limit) || limit <= 0) return undefined;
	return { used: Math.max(0, used), limit };
}

/** Pooled usage over the contributors that carry absolutes. */
function weightedPercent(contributors: readonly { absolutes: AbsoluteAmounts }[]): number {
	let used = 0;
	let limit = 0;
	for (const contributor of contributors) {
		used += contributor.absolutes.used;
		limit += contributor.absolutes.limit;
	}
	return limit > 0 ? (used / limit) * 100 : 0;
}

/**
 * An idle account's reset says nothing about when the pool recovers, so a
 * contributor that reports `used` only wins with `used > 0`. When no contributor
 * reports absolutes at all there is no activity signal to filter on, so every
 * finite reset is eligible.
 */
function earliestActiveReset(contributors: readonly HttpQuotaWindow[]): string | undefined {
	const reporting = contributors.filter(
		(window) => typeof window.used === "number" && Number.isFinite(window.used),
	);
	const candidates =
		reporting.length === 0 ? contributors : reporting.filter((window) => (window.used ?? 0) > 0);

	let earliest: { at: number; iso: string } | undefined;
	for (const window of candidates) {
		const iso = parseQuotaResetAt(window.resetsAt);
		if (iso === undefined) continue;
		const at = Date.parse(iso);
		if (earliest === undefined || at < earliest.at) earliest = { at, iso };
	}
	return earliest?.iso;
}

function aggregateProviderWindows(
	accounts: readonly HttpQuotaAccount[],
	dropUnsummable: boolean,
): HttpQuotaWindow[] {
	const groups = new Map<string, HttpQuotaWindow[]>();
	for (const account of accounts) {
		for (const window of account.windows) {
			const group = groups.get(window.id);
			if (group === undefined) groups.set(window.id, [window]);
			else group.push(window);
		}
	}

	const pooled: HttpQuotaWindow[] = [];
	for (const [id, contributors] of groups) {
		const weighted = contributors.flatMap((window) => {
			const absolutes = readAbsolutes(window);
			return absolutes === undefined ? [] : [{ absolutes }];
		});
		const percentageOnly = contributors.length - weighted.length;
		let usedPercent: number;
		let approximate = false;

		if (weighted.length === 0) {
			// No contributor carries absolutes. The mean is exact only when the
			// allowances are equal, which is the best assumption available here.
			usedPercent =
				contributors.reduce((sum, window) => sum + window.usedPercent, 0) / contributors.length;
		} else {
			usedPercent = weightedPercent(weighted);
			// Mixed pool: the absolute contributors are weighted exactly; the
			// percentage-only ones cannot be, so the figure is approximate.
			approximate = percentageOnly > 0;
		}
		if (dropUnsummable && approximate) continue;

		const representative = [...contributors].sort((left, right) => compare(left.label, right.label))[0]!;
		const resetsAt = earliestActiveReset(contributors);
		pooled.push({
			id,
			kind: representative.kind,
			label: approximate ? `${representative.label}~` : representative.label,
			usedPercent: roundPercent(usedPercent),
			...(resetsAt === undefined ? {} : { resetsAt }),
		});
	}

	return pooled.sort(
		(left, right) => KIND_ORDER[left.kind] - KIND_ORDER[right.kind] || compare(left.id, right.id),
	);
}

function roundPercent(value: number): number {
	return Math.round(Math.min(100, Math.max(0, value)) * 100) / 100;
}

function compare(left: string, right: string): number {
	return left < right ? -1 : left > right ? 1 : 0;
}

export async function collectQuota(
	packs: readonly Pack[],
	options: Omit<QuotaOptions, "baseUrl" | "apiKey"> = {},
): Promise<{ response: HttpQuotaResponse; errors: { providerId: string; error: string }[] }> {
	const quotaPacks = packs.filter((pack) => pack.hooks?.quota !== undefined);
	if (quotaPacks.length === 0) {
		return { response: { version: 1, accounts: [] }, errors: [] };
	}
	const settled = await Promise.allSettled(quotaPacks.map((pack) => fetchQuota(pack, options)));
	const accounts: HttpQuotaAccount[] = [];
	const errors: { providerId: string; error: string }[] = [];
	for (const [index, outcome] of settled.entries()) {
		const pack = quotaPacks[index]!;
		if (outcome.status === "fulfilled") {
			accounts.push(...outcome.value.response.accounts);
		} else {
			const message = outcome.reason instanceof Error ? outcome.reason.message : String(outcome.reason);
			errors.push({ providerId: pack.id, error: message });
		}
	}
	return { response: { version: 1, accounts }, errors };
}

function jsonReply(status: number, payload: unknown): QuotaHttpReply {
	return {
		status,
		headers: {
			"Content-Type": "application/json; charset=utf-8",
			"Cache-Control": "no-store",
		},
		body: JSON.stringify(payload),
	};
}

/** Handles one HTTP request for T3 Code's HTTP quota source protocol. */
export async function handleQuotaRequest(
	request: QuotaHttpRequest,
	options: QuotaHandlerOptions,
): Promise<QuotaHttpReply> {
	if (request.method !== "GET") {
		return {
			status: 405,
			headers: {
				Allow: "GET",
				"Content-Type": "application/json; charset=utf-8",
			},
			body: JSON.stringify({ error: "Method not allowed" }),
		};
	}

	const path = request.path.split("?", 1)[0] ?? "/";
	if (path === "/health") {
		return jsonReply(200, { ok: true });
	}
	if (path !== "/" && path !== "/quota") {
		return jsonReply(404, { error: "Not found" });
	}

	if (options.token !== undefined && options.token.length > 0 && !matchesBearer(request.authorization, options.token)) {
		return jsonReply(401, { error: "Unauthorized" });
	}

	const quotaPacks = options.packs.filter((pack) => pack.hooks?.quota !== undefined);
	if (quotaPacks.length === 0) {
		return jsonReply(200, { version: 1, accounts: [] } satisfies HttpQuotaResponse);
	}

	const { response, errors } = await collectQuota(quotaPacks, {
		...(options.providerInstanceId === undefined ? {} : { providerInstanceId: options.providerInstanceId }),
		...(options.timeoutMs === undefined ? {} : { timeoutMs: options.timeoutMs }),
	});
	if (errors.length === quotaPacks.length) {
		return jsonReply(502, { error: "Quota source failed", details: errors });
	}
	return jsonReply(200, response);
}
