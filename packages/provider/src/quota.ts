import {
	parseQuotaResetAt,
	quotaWindowLabel,
	type HookContext,
	type HttpQuotaAccount,
	type HttpQuotaWindow,
} from "@luthfisolahudin/ai-integrations-contract";

import { COMMAND_CODE_CLI_VERSION } from "./cliVersion.ts";

/** T3 renders only the window label in its per-thread Limits row, and several sources can be registered. */
const PROVIDER = "CommandCode";

const PLAN_NAMES: Readonly<Record<string, string>> = {
	"individual-go": "Go",
	"individual-go-v1": "Go",
	"individual-goat": "GOAT",
	"individual-pro": "Pro",
	"individual-pro-v1": "Pro",
	"individual-provider": "Provider",
	"individual-max": "Max",
	"individual-ultra": "Ultra",
	"teams-pro": "Teams Pro",
};

const PLAN_CAPS: Readonly<Record<string, number>> = {
	"individual-go": 10,
	"individual-go-v1": 10,
	"individual-goat": 70,
	"individual-pro": 30,
	"individual-pro-v1": 80,
	"individual-provider": 15,
	"individual-max": 150,
	"individual-ultra": 300,
	"teams-pro": 40,
};

const PLAN_ID_ALIASES: Readonly<Record<string, string>> = {
	go: "individual-go",
	"go-v1": "individual-go-v1",
	goat: "individual-goat",
	pro: "individual-pro",
	provider: "individual-provider",
	max: "individual-max",
	ultra: "individual-ultra",
};

function normalizePlanId(planId: unknown): string | undefined {
	if (typeof planId !== "string") return undefined;
	const trimmed = planId.trim().toLowerCase();
	if (trimmed.length === 0) return undefined;
	return PLAN_ID_ALIASES[trimmed] ?? trimmed;
}

function finiteNumber(value: unknown): number | undefined {
	return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function clampPercent(value: number): number {
	return Math.round(Math.min(100, Math.max(0, value)) * 100) / 100;
}

function withQuery(base: string, route: string, params: Record<string, string | undefined>): string {
	const query = new URLSearchParams();
	for (const [key, value] of Object.entries(params)) {
		if (value !== undefined && value.length > 0) query.set(key, value);
	}
	const qs = query.toString();
	return qs.length > 0 ? `${base}${route}?${qs}` : `${base}${route}`;
}

interface WhoamiPayload {
	user?: { name?: string; email?: string };
	org?: { id?: string; name?: string } | null;
}

interface WindowPayload {
	used?: number;
	cap?: number;
	resetAt?: number | string | null;
}

interface CreditsPayload {
	credits?: {
		monthlyCredits?: number;
		purchasedCredits?: number;
		freeCredits?: number;
	};
	windowLimits?: {
		fiveHour?: WindowPayload;
		weekly?: WindowPayload;
	};
}

interface SubscriptionPayload {
	data?: {
		planId?: string;
		currentPeriodEnd?: string;
	};
}

function windowFromLimit(
	id: string,
	kind: HttpQuotaWindow["kind"],
	label: string,
	limit: WindowPayload | undefined,
): HttpQuotaWindow | undefined {
	if (!limit) return undefined;
	const cap = finiteNumber(limit.cap) ?? 0;
	const used = finiteNumber(limit.used) ?? 0;
	if (cap <= 0 && used <= 0) return undefined;
	const usedPercent = cap > 0 ? clampPercent((used / cap) * 100) : 100;
	const resetsAt = parseQuotaResetAt(limit.resetAt);
	return {
		id,
		kind,
		label,
		usedPercent,
		// Absolutes are source-internal: the engine strips them before serving.
		...(cap > 0 ? { used, limit: cap } : {}),
		...(resetsAt === undefined ? {} : { resetsAt }),
	};
}

export async function readCommandCodeQuota(
	context: HookContext,
	fetchImpl: typeof globalThis.fetch = globalThis.fetch,
): Promise<HttpQuotaAccount[]> {
	if (!context.apiKey) {
		throw new Error("CommandCode API key is required to read quota");
	}
	const origin = new URL(context.baseUrl).origin;
	const headers: Record<string, string> = {
		Accept: "application/json",
		Authorization: `Bearer ${context.apiKey}`,
		"User-Agent": "cli",
		"x-command-code-version": COMMAND_CODE_CLI_VERSION,
	};

	const getJson = async <T>(url: string): Promise<T> => {
		const response = await fetchImpl(url, { headers, signal: context.signal });
		if (response.status === 401 || response.status === 403) {
			throw new Error(`CommandCode authentication failed (HTTP ${response.status})`);
		}
		if (!response.ok) {
			throw new Error(`CommandCode quota request failed (${url} returned HTTP ${response.status})`);
		}
		return (await response.json()) as T;
	};

	const whoami = await getJson<WhoamiPayload>(withQuery(origin, "/alpha/whoami", { limits: "1" }));
	const orgId = typeof whoami.org?.id === "string" && whoami.org.id.trim().length > 0 ? whoami.org.id.trim() : undefined;

	const [credits, subs] = await Promise.all([
		getJson<CreditsPayload>(withQuery(origin, "/alpha/billing/credits", { orgId })),
		getJson<SubscriptionPayload>(withQuery(origin, "/alpha/billing/subscriptions", { orgId })),
	]);

	const rawPlanId = subs.data?.planId;
	const planId = normalizePlanId(rawPlanId);
	const planLabel = (planId && PLAN_NAMES[planId]) || (typeof rawPlanId === "string" && rawPlanId.trim()) || "Command Code";
	const cap = planId ? (PLAN_CAPS[planId] ?? 0) : 0;

	const c = credits.credits ?? {};
	const remaining =
		(finiteNumber(c.monthlyCredits) ?? 0) +
		(finiteNumber(c.purchasedCredits) ?? 0) +
		(finiteNumber(c.freeCredits) ?? 0);

	const windows: HttpQuotaWindow[] = [];

	const fiveHour = windowFromLimit("5h", "session", quotaWindowLabel("Session", PROVIDER), credits.windowLimits?.fiveHour);
	if (fiveHour !== undefined) windows.push(fiveHour);

	const weekly = windowFromLimit("weekly", "weekly", quotaWindowLabel("Weekly", PROVIDER), credits.windowLimits?.weekly);
	if (weekly !== undefined) windows.push(weekly);

	if (cap > 0) {
		const used = Math.max(0, cap - remaining);
		const resetsAt = parseQuotaResetAt(subs.data?.currentPeriodEnd);
		windows.push({
			id: "monthly",
			kind: "monthly",
			label: quotaWindowLabel("Monthly", PROVIDER),
			usedPercent: clampPercent((used / cap) * 100),
			...(resetsAt === undefined ? {} : { resetsAt }),
		});
	}

	const email = typeof whoami.user?.email === "string" && whoami.user.email.trim().length > 0 ? whoami.user.email.trim() : undefined;
	const identity = email ?? orgId ?? "default";
	const detail = email ? `${planLabel} · ${email}` : planLabel;

	return [
		{
			id: `commandcode-${identity}`,
			label: `Command Code (${detail})`,
			windows,
		},
	];
}
