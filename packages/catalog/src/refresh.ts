import type { NormalizedModel, Pack, RawRecord } from "@luthfisolahudin/commandcode-integrations-contract";

import { isFresh, type Snapshot } from "./cache.ts";
import { discover, type DiscoverOptions } from "./discover.ts";
import type { ModelIndex } from "./modelsdev.ts";
import { buildModels } from "./provenance.ts";

export interface RefreshOutcome {
	models: NormalizedModel[];
	/** Where the models came from, so defaults are never mistaken for a live catalog. */
	source: "snapshot" | "network" | "fallback";
	checkedAt: number;
	etag?: string;
	notModified: boolean;
	/** Raw provider records, present only for a network refresh; used to persist a snapshot. */
	raw?: RawRecord[];
}

export interface RefreshOptions extends DiscoverOptions {
	snapshot?: Snapshot;
	/** Skip the network entirely while the snapshot is younger than this. */
	ttlMs?: number;
	modelsDev?: ModelIndex;
	measuredIds?: ReadonlySet<string>;
	/** Called once per improvement so a host can publish without waiting. */
	onModels?: (outcome: RefreshOutcome) => void;
}

/**
 * Cache-first refresh: publish the snapshot immediately, then ask the network.
 * A failed request keeps the snapshot; it never empties the provider.
 */
export async function refreshCatalog(pack: Pack, options: RefreshOptions = {}): Promise<RefreshOutcome> {
	const state: RefreshOutcome = { models: [], source: "fallback", checkedAt: 0, notModified: false };
	const buildOptions = {
		...(options.modelsDev === undefined ? {} : { modelsDev: options.modelsDev }),
		...(options.measuredIds === undefined ? {} : { measuredIds: options.measuredIds }),
	};

	if (options.snapshot !== undefined) {
		state.models = buildModels(pack, options.snapshot.raw as RawRecord[], buildOptions);
		state.source = "snapshot";
		state.checkedAt = options.snapshot.checkedAt;
		options.onModels?.({ ...state });
	}

	const now = options.now?.() ?? Date.now();
	if (options.snapshot !== undefined && options.ttlMs !== undefined && isFresh(options.snapshot, options.ttlMs, now)) {
		return state;
	}

	let result;
	try {
		result = await discover(pack, options);
	} catch (error) {
		// Offline is a normal state: keep the snapshot, or the pinned fallback.
		if (state.models.length > 0) return state;
		const pinned = buildModels(pack, [], buildOptions);
		state.models = pinned;
		options.onModels?.({ ...state });
		throw error;
	}

	if (result.notModified) {
		state.notModified = true;
		return state;
	}

	const outcome: RefreshOutcome = {
		models: buildModels(pack, result.raw, buildOptions),
		source: "network",
		checkedAt: result.checkedAt,
		notModified: false,
		raw: result.raw,
		...(result.etag === undefined ? {} : { etag: result.etag }),
	};
	options.onModels?.(outcome);
	return outcome;
}
