import { positiveFinite } from "./capabilities.ts";
import type { Source } from "./record.ts";

export interface LimitResolution {
	value: number;
	source: Source;
}

/**
 * Resolution ladder for one limit: catalog, then curated, then models.dev, then
 * the pack default. First hit wins and the winner is recorded, so a defaulted
 * number is never mistaken for a measured one.
 *
 * `capBy` clamps the result, used to keep `maxOutput <= contextWindow`.
 */
export function resolveLimit(input: {
	catalog?: unknown;
	curated?: unknown;
	modelsDev?: unknown;
	defaultValue: number;
	capBy?: number;
}): LimitResolution {
	const candidates: [unknown, Source][] = [
		[input.catalog, "catalog"],
		[input.curated, "curated"],
		[input.modelsDev, "models.dev"],
	];
	for (const [value, source] of candidates) {
		const resolved = positiveFinite(value);
		if (resolved !== undefined) return { value: clamp(resolved, input.capBy), source };
	}
	return { value: clamp(input.defaultValue, input.capBy), source: "default" };
}

function clamp(value: number, capBy: number | undefined): number {
	if (capBy === undefined) return value;
	return Math.min(value, capBy);
}
