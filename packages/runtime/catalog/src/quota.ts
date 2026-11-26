import { createHash, timingSafeEqual } from "node:crypto";

import {
	validateQuotaResponse,
	type HookContext,
	type HttpQuotaAccount,
	type HttpQuotaResponse,
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
	const accounts: HttpQuotaAccount[] = rawAccounts.map((account) => {
		if (account.providerInstanceId !== undefined || options.providerInstanceId === undefined) {
			return account;
		}
		return { ...account, providerInstanceId: options.providerInstanceId };
	});
	const response: HttpQuotaResponse = { version: 1, accounts };
	validateQuotaResponse(response);
	return { response, checkedAt: Date.now() };
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
