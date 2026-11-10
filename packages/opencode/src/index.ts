import { Model, Plugin, Provider } from "@opencode/plugin";
import {
  loadCatalog,
  resolveCommandCodeKey,
} from "commandcode-integrations-core";
import type { CatalogStore, StoredCatalog } from "commandcode-integrations-core";

import { toOpenCodeModelFields } from "./model.ts";

const DEFAULT_BASE_URL = "https://api.commandcode.ai/provider/v1";
const DEFAULT_MAX_OUTPUT = 32_768;
const DEFAULT_API_KEY_ENV = "COMMANDCODE_API_KEY";
const REFRESH_FLOOR_MS = 60_000;
const USER_AGENT = "commandcode-integrations/0.1";

function stringOption(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const text = value.trim();
  return text ? text : undefined;
}

function numberOption(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : undefined;
}

function booleanOption(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

function isStoredCatalog(value: unknown): value is StoredCatalog {
  if (!value || typeof value !== "object") return false;
  const catalog = value as Partial<StoredCatalog>;
  return (
    catalog.schemaVersion === 1 &&
    typeof catalog.catalogVersion === "string" &&
    typeof catalog.refreshAfterSeconds === "number" &&
    typeof catalog.fetchedAt === "number" &&
    Array.isArray(catalog.models)
  );
}

function resolveApiKey(option: unknown, optionEnv: unknown): string {
  const literal = stringOption(option);
  if (literal) return literal;

  const envName = stringOption(optionEnv) ?? DEFAULT_API_KEY_ENV;
  const fromEnv = process.env[envName]?.trim();
  if (fromEnv) return fromEnv;

  return resolveCommandCodeKey() ?? "";
}

export default Plugin.define({
  id: "opencode.provider.commandcode",
  async setup(ctx) {
    const options = ctx.options;
    const providerID = Provider.ID.make(stringOption(options.providerID) ?? "commandcode");
    const providerName = stringOption(options.name) ?? "Command Code";
    const baseURL = (stringOption(options.baseURL) ?? DEFAULT_BASE_URL).replace(/\/+$/, "");
    const apiKey = resolveApiKey(options.apiKey, options.apiKeyEnv);
    const includeHidden = booleanOption(options.includeHidden) ?? false;
    const defaultMaxOutput = numberOption(options.defaultMaxOutput) ?? DEFAULT_MAX_OUTPUT;

    const storageKey = `catalog:${String(providerID)}`;
    const store: CatalogStore = {
      async read() {
        const value = await ctx.storage.get(storageKey);
        return isStoredCatalog(value) ? value : undefined;
      },
      async write(value) {
        await ctx.storage.set(storageKey, value as never);
      },
    };

    let catalog: StoredCatalog;
    try {
      catalog = await loadCatalog({ store, apiKey, allowNetwork: false });
    } catch {
      try {
        catalog = await loadCatalog({ store, apiKey, timeoutMs: 5_000 });
      } catch (error) {
        console.error("CommandCode provider: unable to load the model catalog", error);
        return;
      }
    }

    let current = catalog;

    const providerInfo = {
      ...Provider.Info.empty(providerID),
      name: providerName,
      activation: "enabled" as const,
      package: "@opencode/ai/providers/openai-compatible",
      settings: { baseURL, apiKey },
      headers: { "User-Agent": USER_AGENT },
    };

    const buildModels = () =>
      current.models
        .filter((model) => includeHidden || !model.hidden)
        .map((model) => {
          const base = Model.Info.default(providerID, Model.ID.make(model.id));
          const fields = toOpenCodeModelFields(model, defaultMaxOutput);
          return {
            ...base,
            ...fields,
            variants: fields.variants as never,
          };
        });

    await ctx.provider.transform((editor) => {
      const models = buildModels();
      const existing = editor.get(providerID);
      if (existing) {
        editor.update(providerID, (provider) => {
          provider.name = providerName;
          provider.activation = "enabled";
          provider.package = "@opencode/ai/providers/openai-compatible";
          provider.settings = { ...(provider.settings ?? {}), baseURL, apiKey };
          provider.headers = { ...(provider.headers ?? {}), "User-Agent": USER_AGENT };
        });
        editor.models.set(providerID, models as never);
      } else {
        editor.add({ info: providerInfo as never, models: models as never });
      }
    });

    const refresh = async () => {
      try {
        const next = await loadCatalog({ store, apiKey, allowNetwork: true });
        const changed =
          next.catalogVersion !== current.catalogVersion ||
          JSON.stringify(next.models) !== JSON.stringify(current.models);
        if (!changed) return;
        current = next;
        await ctx.provider.reload();
      } catch (error) {
        console.error("CommandCode provider: model refresh failed", error);
      }
    };

    const interval = Math.max(REFRESH_FLOOR_MS, current.refreshAfterSeconds * 1000);
    const timer = setInterval(() => void refresh(), interval);
    timer.unref?.();
    void refresh();

    return () => clearInterval(timer);
  },
});
