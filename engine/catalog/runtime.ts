import { createHash } from "node:crypto";
import type { Pack } from "../contract/index.ts";

import { modelsDevCachePath, readSnapshot, snapshotPath, writeSnapshot } from "./cache.ts";
import { resolveApiKey } from "./discover.ts";
import { readCachedModelIndex } from "./modelsdev.ts";
import { baselineCatalog, refreshCatalog, type RefreshOutcome } from "./refresh.ts";

const TTL_MS = 10 * 60_000;

export interface CatalogConnection {
	apiKey?: string;
	baseUrl?: string;
}

export function createCatalogRuntime(pack: Pack, measuredEffort: Readonly<Record<string, string>> = {}) {
	const measuredIds = new Set(Object.keys(measuredEffort));
	const failedConnections = new Map<string, string>();

	function options(connection: CatalogConnection) {
		const source = { ...pack, baseUrl: connection.baseUrl ?? pack.baseUrl };
		const apiKey = pack.auth?.kind === "none" ? undefined : connection.apiKey?.trim() || resolveApiKey(source);
		// Hook-produced snapshots can contain derived routing, visibility and rates.
		// Older hook results must be rediscovered after those rules change.
		const snapshotFormat = pack.hooks?.discover === undefined ? 1 : 2;
		const scope = createHash("sha256").update(JSON.stringify([snapshotFormat, pack.schemaVersion, source.baseUrl, apiKey])).digest("hex");
		const path = snapshotPath({ providerId: `${pack.id}-${scope}` });
		return {
			source,
			path,
			apiKey,
			snapshot: readSnapshot(path),
			measuredIds,
			modelsDev: readCachedModelIndex(modelsDevCachePath()),
		};
	}

	return {
		baseline(connection: CatalogConnection = {}) {
			const state = options(connection);
			return baselineCatalog(state.source, state, state.snapshot);
		},
		async refresh(connection: CatalogConnection = {}, request: { signal?: AbortSignal; force?: boolean } = {}): Promise<RefreshOutcome> {
			const state = options(connection);
			const result = await refreshCatalog(state.source, { ...state, ...request, ttlMs: TTL_MS });
			if (result.error !== undefined && !request.signal?.aborted) {
				const message = result.error.message;
				if (failedConnections.get(state.path) !== message) {
					console.warn(pack.id + ": model discovery failed, using " + result.source + ": " + message);
					failedConnections.set(state.path, message);
				}
			} else if (result.source === "network") {
				failedConnections.delete(state.path);
			}
			if (result.source === "network" && result.snapshot !== undefined) {
				const current = readSnapshot(state.path);
				if (current === undefined || current.checkedAt <= result.snapshot.checkedAt) writeSnapshot(state.path, result.snapshot);
			}
			return result;
		},
	};
}
