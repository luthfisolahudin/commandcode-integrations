import {
	buildModels,
	loadModelIndex,
	modelsDevCachePath,
	readCachedModelIndex,
	readSnapshot,
	refreshCatalog,
	snapshotPath,
	writeSnapshot,
} from "@luthfisolahudin/commandcode-integrations-catalog";
import type { Pack } from "@luthfisolahudin/commandcode-integrations-contract";
import { MEASURED_WIRE_EFFORT, measuredIds, packs } from "@luthfisolahudin/commandcode-integrations-provider";
import { Plugin } from "@opencode/plugin";

import { DEFAULT_PACKAGE, toOpencodeModels, type OpencodeModel, type OpencodeProviderInfo } from "./model.ts";

const TTL_MS = 10 * 60_000;

/**
 * The OpenCode side of the host API is intentionally narrowed to the subset we
 * use. The published schema is Effect-typed and versioned with the host, so a
 * structural contract keeps this adapter readable and testable; `provider-doctor`
 * and a live `opencode models` run are the compatibility checks.
 */
interface ProviderEditor {
	add(input: { info: OpencodeProviderInfo; models: readonly OpencodeModel[] }): void;
	get(providerId: string): { models: ReadonlyMap<string, OpencodeModel> } | undefined;
	readonly models: { set(providerId: string, models: readonly OpencodeModel[]): void };
}

interface HostContext {
	readonly provider: {
		transform(transform: (editor: ProviderEditor) => void): Promise<unknown>;
		reload(): Promise<void>;
	};
}

function providerInfo(pack: Pack): OpencodeProviderInfo {
	const envName = pack.auth?.apiKeyEnv;
	const apiKey = envName === undefined ? undefined : process.env[envName]?.trim();
	return {
		id: pack.id,
		name: pack.name,
		activation: "enabled",
		package: pack.hosts?.opencode?.package ?? DEFAULT_PACKAGE,
		settings: {
			baseURL: pack.baseUrl,
			...(apiKey === undefined || apiKey.length === 0 ? {} : { apiKey }),
		},
	};
}

function baseline(pack: Pack): OpencodeModel[] {
	const snapshot = readSnapshot(snapshotPath({ providerId: pack.id }));
	const modelsDev = readCachedModelIndex(modelsDevCachePath());
	const models = buildModels(pack, snapshot?.raw ?? [], { measuredIds, ...(modelsDev === undefined ? {} : { modelsDev }) });
	return toOpencodeModels(models, MEASURED_WIRE_EFFORT, pack.thinkingFormatOverrides);
}

/**
 * Registers every pack as an OpenCode provider.
 *
 * Cached inventory is installed before any network work: cold callers (T3 Code)
 * allow model discovery only a few seconds. The refresh runs in the background
 * and calls `reload()` only after it has new models.
 */
export default Plugin.define({
	id: "example-catalog",
	async setup(context) {
		const host = context as unknown as HostContext;
		const inventory = new Map<string, OpencodeModel[]>();
		for (const pack of packs) inventory.set(pack.id, baseline(pack));

		await host.provider.transform((editor) => {
			for (const pack of packs) {
				const discovered = inventory.get(pack.id) ?? [];
				const existing = editor.get(pack.id);
				if (existing !== undefined) {
					// Merge keeps host-side entries (models.dev) and adds discovered ones.
					const merged = new Map(existing.models);
					for (const model of discovered) merged.set(model.id, model);
					editor.models.set(pack.id, [...merged.values()]);
					continue;
				}
				editor.add({ info: providerInfo(pack), models: discovered });
			}
		});

		const refresh = async () => {
			let changed = false;
			for (const pack of packs) {
				try {
					const modelsDev = await loadModelIndex({ cachePath: modelsDevCachePath() });
					const outcome = await refreshCatalog(pack, {
						snapshot: readSnapshot(snapshotPath({ providerId: pack.id })),
						ttlMs: TTL_MS,
						measuredIds,
						modelsDev,
					});
					const models = toOpencodeModels(outcome.models, MEASURED_WIRE_EFFORT, pack.thinkingFormatOverrides);
					if (models.length > 0) {
						inventory.set(pack.id, models);
						changed = true;
						if (outcome.source === "network") {
							writeSnapshot(snapshotPath({ providerId: pack.id }), {
								checkedAt: outcome.checkedAt,
								...(outcome.etag === undefined ? {} : { etag: outcome.etag }),
								raw: outcome.raw ?? [],
							});
						}
					}
				} catch (error) {
					console.error(
						`${pack.id}: model discovery failed (${
							error instanceof Error ? error.message : String(error)
						}); keeping ${inventory.get(pack.id)?.length ?? 0} known models`,
					);
				}
			}
			if (changed) await host.provider.reload();
		};

		void refresh();
		const timer = setInterval(() => void refresh(), TTL_MS);
		timer.unref?.();

		return () => clearInterval(timer);
	},
});
