import { createCatalogRuntime, resolveApiKey } from "@luthfisolahudin/ai-integrations-catalog";
import type { Pack } from "@luthfisolahudin/ai-integrations-contract";
import { Plugin, Provider } from "@opencode/plugin";

import { DEFAULT_PACKAGE, providerSettings, toOpencodeModels } from "./model.ts";

const REFRESH_MS = 10 * 60_000;

export function createOpenCodePlugin(pack: Pack, effort: Readonly<Record<string, string>> = {}) {
	return Plugin.define({
		id: `opencode.provider.${pack.id}`,
		async setup(context) {
			const catalog = createCatalogRuntime(pack, effort);
			const providerID = Provider.ID.make(pack.id);
			const apiKey = resolveApiKey(pack);
			const connection = { apiKey };
			const project = (result: ReturnType<typeof catalog.baseline>) =>
				toOpencodeModels(result.models, effort, pack.thinkingFormatOverrides, pack.hosts?.opencode?.package);
			const provider = {
				...Provider.Info.empty(providerID),
				name: pack.name,
				activation: "enabled" as const,
				package: pack.hosts?.opencode?.package ?? DEFAULT_PACKAGE,
				settings: providerSettings(pack.baseUrl, apiKey),
				headers: pack.discovery.userAgent === undefined ? undefined : { "User-Agent": pack.discovery.userAgent },
			};
			const baseline = catalog.baseline(connection);
			const initial = baseline.source === "fallback" && baseline.models.length === 0
				? await catalog.refresh(connection)
				: baseline;
			let current = project(initial);
			await context.provider.transform((editor) => {
				if (editor.get(providerID) === undefined) {
					editor.add({ info: provider, models: current });
					return;
				}
				editor.update(providerID, (existing) => Object.assign(existing, provider));
				editor.models.set(providerID, current);
			});

			const lifetime = new AbortController();
			let refreshing = false;
			async function refresh() {
				if (refreshing) return;
				refreshing = true;
				try {
					const next = project(await catalog.refresh(connection, { signal: lifetime.signal }));
					if (lifetime.signal.aborted || JSON.stringify(next) === JSON.stringify(current)) return;
					await context.provider.reload();
					current = next;
				} catch (error) {
					console.error(`${pack.id}: OpenCode model refresh failed`, error);
				} finally {
					refreshing = false;
				}
			}

			if (initial === baseline) void refresh();
			const timer = setInterval(() => void refresh(), REFRESH_MS);
			timer.unref?.();
			return () => {
				lifetime.abort();
				clearInterval(timer);
			};
		},
	});
}
