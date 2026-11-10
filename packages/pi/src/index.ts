import type { AnyModel, Model } from "@earendil-works/pi-ai";
import {
  anthropicMessagesApi,
  createProvider,
  openAICompletionsApi,
  openAIResponsesApi,
} from "@earendil-works/pi-ai/compat";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import {
  FileCatalogStore,
  loadCatalog,
  resolveCommandCodeKey,
} from "commandcode-integrations-core";
import type { CatalogStore, StoredCatalog } from "commandcode-integrations-core";

import { providerBaseUrl, toPiModel, type PiApi } from "./model.ts";

function catalogModels(
  catalog: StoredCatalog,
  baseUrl: string,
): Model<PiApi>[] {
  return catalog.models
    .filter((model) => !model.hidden)
    .map((model) => toPiModel(model, baseUrl));
}

async function loadBaseline(
  store: CatalogStore,
  baseUrl: string,
  apiKey: string | undefined,
): Promise<Model<PiApi>[]> {
  try {
    const cached = await loadCatalog({
      ...(apiKey ? { apiKey } : {}),
      store,
      allowNetwork: false,
    });
    return catalogModels(cached, baseUrl);
  } catch {
    // No snapshot yet; try a short network fetch below.
  }

  try {
    const fresh = await loadCatalog({
      ...(apiKey ? { apiKey } : {}),
      store,
      allowNetwork: true,
      timeoutMs: 5_000,
    });
    return catalogModels(fresh, baseUrl);
  } catch {
    return [];
  }
}

function storedModels(context: {
  stored?: { models: readonly AnyModel[] };
}): readonly Model<PiApi>[] | undefined {
  const models = context.stored?.models;
  if (!models || models.length === 0) return undefined;
  const chat = models.filter((model) => model.type === undefined || model.type === "chat");
  return chat.length > 0 ? (chat as Model<PiApi>[]) : undefined;
}

export default async function commandCodeProvider(pi: ExtensionAPI): Promise<void> {
  const baseUrl = providerBaseUrl(process.env.COMMANDCODE_BASE_URL);
  const cachePath = process.env.COMMANDCODE_CACHE_PATH?.trim();
  const store = new FileCatalogStore(cachePath || undefined);
  const apiKey = resolveCommandCodeKey() || undefined;

  const baseline = await loadBaseline(store, baseUrl, apiKey);

  const provider = createProvider<PiApi>({
    id: "commandcode",
    name: "Command Code",
    baseUrl,
    headers: { "User-Agent": "commandcode-integrations/0.1" },
    auth: {
      apiKey: {
        name: "Command Code API key",
        async login(interaction) {
          const key = await interaction.prompt({
            type: "secret",
            message: "Command Code API key",
          });
          return { type: "api_key", key };
        },
        async resolve({ credential }) {
          const credentialKey =
            credential?.type === "api_key" ? credential.key?.trim() : undefined;
          const key = credentialKey || resolveCommandCodeKey();
          return key
            ? { auth: { apiKey: key }, source: "Command Code API key" }
            : undefined;
        },
      },
    },
    models: baseline,
    async fetchModels(context) {
      if (!context.allowNetwork) {
        const cached = storedModels(context);
        if (cached) return cached;
      }

      const credentialKey =
        context.credential?.type === "api_key" ? context.credential.key?.trim() : undefined;
      const apiKey = credentialKey || resolveCommandCodeKey() || undefined;

      try {
        const catalog = await loadCatalog({
          ...(apiKey ? { apiKey } : {}),
          store,
          allowNetwork: context.allowNetwork,
          signal: context.signal,
          ...(context.force ? { force: true } : {}),
        });

        const models = catalog.models
          .filter((model) => !model.hidden)
          .map((model) => toPiModel(model, baseUrl));

        return models;
      } catch (error) {
        const cached = storedModels(context);
        if (cached) return cached;
        throw error;
      }
    },
    api: {
      "openai-completions": openAICompletionsApi(),
      "openai-responses": openAIResponsesApi(),
      "anthropic-messages": anthropicMessagesApi(),
    },
  });

  pi.registerProvider(provider);
}
