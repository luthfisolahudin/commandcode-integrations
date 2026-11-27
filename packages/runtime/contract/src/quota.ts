export const QUOTA_WINDOW_KINDS = new Set(["session", "weekly", "monthly", "other"] as const);

export type HttpQuotaWindowKind = "session" | "weekly" | "monthly" | "other";

export interface HttpQuotaWindow {
	id: string;
	kind: HttpQuotaWindowKind;
	label: string;
	usedPercent: number;
	resetsAt?: string;
	/**
	 * Absolute amount as the vendor reported it. Omitted when the vendor only
	 * publishes a percentage. T3 ignores these fields; the engine uses them to
	 * fold several accounts of one product exactly instead of averaging
	 * percentages.
	 */
	used?: number;
	/** Absolute allowance paired with `used`. Same rules. */
	limit?: number;
}

export interface HttpQuotaAccount {
	id: string;
	label: string;
	providerInstanceId?: string;
	windows: HttpQuotaWindow[];
}

export interface HttpQuotaResponse {
	version: 1;
	accounts: HttpQuotaAccount[];
}

function assertNonEmpty(value: unknown, label: string): asserts value is string {
	if (typeof value !== "string" || value.trim().length === 0) {
		throw new Error(`${label} must be a non-empty string`);
	}
}

export function validateQuotaWindow(window: HttpQuotaWindow, context: string): void {
	assertNonEmpty(window.id, `${context}.id`);
	assertNonEmpty(window.label, `${context}.label`);
	if (!QUOTA_WINDOW_KINDS.has(window.kind)) {
		throw new Error(`${context}.kind "${String(window.kind)}" must be session, weekly, monthly, or other`);
	}
	if (!Number.isFinite(window.usedPercent) || window.usedPercent < 0 || window.usedPercent > 100) {
		throw new Error(`${context}.usedPercent must be a finite number between 0 and 100`);
	}
	for (const field of ["used", "limit"] as const) {
		const value = window[field];
		if (value === undefined) continue;
		if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
			throw new Error(`${context}.${field} must be a finite number greater than or equal to 0`);
		}
	}
	if (window.resetsAt !== undefined) {
		assertNonEmpty(window.resetsAt, `${context}.resetsAt`);
		if (!Number.isFinite(Date.parse(window.resetsAt))) {
			throw new Error(`${context}.resetsAt "${window.resetsAt}" is not a valid ISO timestamp`);
		}
	}
}

export function validateQuotaAccount(account: HttpQuotaAccount, index = 0): void {
	const prefix = `accounts[${index}]`;
	assertNonEmpty(account.id, `${prefix}.id`);
	assertNonEmpty(account.label, `${prefix}.label`);
	if (account.providerInstanceId !== undefined) {
		assertNonEmpty(account.providerInstanceId, `${prefix}.providerInstanceId`);
	}
	if (!Array.isArray(account.windows)) {
		throw new Error(`${prefix}.windows must be an array`);
	}
	for (const [windowIndex, window] of account.windows.entries()) {
		validateQuotaWindow(window, `${prefix}.windows[${windowIndex}]`);
	}
}

export function validateQuotaResponse(response: HttpQuotaResponse): void {
	if (response.version !== 1) {
		throw new Error(`quota response version must be 1, got ${String(response.version)}`);
	}
	if (!Array.isArray(response.accounts)) {
		throw new Error("quota response accounts must be an array");
	}
	for (const [index, account] of response.accounts.entries()) {
		validateQuotaAccount(account, index);
	}
}

/**
 * Ages reach the protocol in several shapes; one accepting parser keeps every
 * pack honest. Epoch seconds (below 1e12) and epoch milliseconds both become an
 * ISO string, as does a parseable date string. `undefined` means "the vendor
 * gave us nothing usable", never "now".
 */
export function parseQuotaResetAt(value: unknown): string | undefined {
	if (typeof value === "number") return isoFromEpoch(value);
	if (typeof value !== "string") return undefined;
	const trimmed = value.trim();
	if (trimmed.length === 0) return undefined;
	const numeric = Number(trimmed);
	if (Number.isFinite(numeric)) return isoFromEpoch(numeric);
	const parsed = Date.parse(trimmed);
	return Number.isFinite(parsed) ? new Date(parsed).toISOString() : undefined;
}

function isoFromEpoch(value: number): string | undefined {
	if (!Number.isFinite(value) || value <= 0) return undefined;
	const date = new Date(value < 1e12 ? value * 1000 : value);
	return Number.isFinite(date.getTime()) ? date.toISOString() : undefined;
}

/** T3 renders only `window.label` in its per-thread Limits row, so the source has to name itself there. */
export const QUOTA_LABEL_SEPARATOR = "\u00b7";

/**
 * Builds a window label that names the provider: `Session · CommandCode`.
 * `detail` distinguishes accounts or pools of one product, so it goes in the
 * same trailing parenthetical the account label uses.
 */
export function quotaWindowLabel(period: string, source: string, detail?: string): string {
	const label = `${period.trim()} ${QUOTA_LABEL_SEPARATOR} ${source.trim()}`;
	const trimmed = detail?.trim();
	return trimmed === undefined || trimmed.length === 0 ? label : `${label} (${trimmed})`;
}
