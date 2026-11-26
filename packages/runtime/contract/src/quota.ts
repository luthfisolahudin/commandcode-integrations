export const QUOTA_WINDOW_KINDS = new Set(["session", "weekly", "monthly", "other"] as const);

export type HttpQuotaWindowKind = "session" | "weekly" | "monthly" | "other";

export interface HttpQuotaWindow {
	id: string;
	kind: HttpQuotaWindowKind;
	label: string;
	usedPercent: number;
	resetsAt?: string;
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
