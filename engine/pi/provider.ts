import { createCatalogRuntime, resolveApiKey } from "../catalog/index.ts";
import type { Pack } from "../contract/index.ts";
import {
	anthropicMessagesApi,
	createProvider,
	openAICompletionsApi,
	openAIResponsesApi,
} from "@earendil-works/pi-ai/compat";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

import { toPiModels } from "./model.ts";

export function createPiExtension(pack: Pack, effort: Readonly<Record<string, string>> = {}) {
	return (pi: ExtensionAPI): void => {
		const catalog = createCatalogRuntime(pack, effort);
		const project = (records: ReturnType<typeof catalog.baseline>, baseUrl = pack.baseUrl) =>
			toPiModels(records.models, effort, {
				providerId: pack.id,
				baseUrl,
				compat: pack.hosts?.pi?.compat,
				thinkingFormatOverrides: pack.thinkingFormatOverrides,
			});

		let current = project(catalog.baseline());
		const provider = createProvider({
			id: pack.id,
			name: pack.name,
			baseUrl: pack.baseUrl,
			headers: pack.discovery.userAgent === undefined ? undefined : { "User-Agent": pack.discovery.userAgent },
			auth: {
				apiKey: {
					name: `${pack.name} API key`,
					async resolve({ credential }) {
						if (pack.auth?.kind === "none") return { auth: { apiKey: "unused" } };
						const key = credential?.key?.trim() || resolveApiKey(pack);
						return key ? { auth: { apiKey: key } } : undefined;
					},
				},
			},
			models: [],
			api: {
				"openai-completions": openAICompletionsApi(),
				"anthropic-messages": anthropicMessagesApi(),
				"openai-responses": openAIResponsesApi(),
			},
		});

		pi.registerProvider({
			...provider,
			getModels: () => current,
			getAllModels: () => current,
			async refreshModels(context) {
				const connection = {
					baseUrl: context.baseUrl,
					apiKey: context.credential?.type === "api_key" ? context.credential.key : undefined,
				};
				const result = context.allowNetwork && !context.signal.aborted
					? await catalog.refresh(connection, { signal: context.signal, force: context.force })
					: catalog.baseline(connection);
				if (context.signal.aborted) return;
				await context.publish({ update: () => { current = project(result, connection.baseUrl); } });
			},
		});
	};
}
