import type { NormalizedModel, Pack } from "../contract/index.ts";

import { isFresh, type Snapshot } from "./cache.ts";
import { discover, type DiscoverOptions } from "./discover.ts";
import { buildFallbackModels, buildModels, type BuildOptions } from "./provenance.ts";

export interface RefreshOutcome {
	models: NormalizedModel[];
	source: "snapshot" | "network" | "fallback";
	snapshot?: Snapshot;
	error?: Error;
}

export interface RefreshOptions extends DiscoverOptions, BuildOptions {
	snapshot?: Snapshot;
	ttlMs?: number;
	force?: boolean;
}

export function baselineCatalog(pack: Pack, options: BuildOptions, snapshot?: Snapshot): RefreshOutcome {
	return snapshot === undefined
		? { models: buildFallbackModels(pack, options), source: "fallback" }
		: { models: buildModels(pack, snapshot.raw, options), source: "snapshot" };
}

export async function refreshCatalog(pack: Pack, options: RefreshOptions = {}): Promise<RefreshOutcome> {
	const snapshot = options.snapshot;
	const now = options.now?.() ?? Date.now();
	if (!options.force && snapshot !== undefined && options.ttlMs !== undefined && isFresh(snapshot, options.ttlMs, now)) {
		return baselineCatalog(pack, options, snapshot);
	}

	try {
		const result = await discover(pack, { ...options, etag: pack.discovery.etag === true ? snapshot?.etag : undefined });
		if (result.notModified && snapshot === undefined) throw new Error(`unexpected HTTP 304 for ${pack.id}`);
		const next: Snapshot = result.notModified
			? { ...snapshot!, checkedAt: result.checkedAt, etag: result.etag ?? snapshot?.etag }
			: { raw: result.raw, checkedAt: result.checkedAt, etag: result.etag };
		return { models: buildModels(pack, next.raw, options), source: "network", snapshot: next };
	} catch (error) {
		return { ...baselineCatalog(pack, options, snapshot), error: error instanceof Error ? error : new Error(String(error)) };
	}
}
