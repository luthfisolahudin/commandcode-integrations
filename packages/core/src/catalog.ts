import { resolveProtocol } from "./protocol.ts";
import type {
  CommandCodeEffort,
  CommandCodeModel,
  CommandCodePricing,
  CommandCodePricingTier,
  LoadCatalogOptions,
  StoredCatalog,
} from "./types.ts";

const EFFORTS = new Set<CommandCodeEffort>([
  "off",
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
]);

const DEFAULT_BASE_URL = "https://api.commandcode.ai/provider/v1";
const DEFAULT_USER_AGENT = "commandcode-integrations/0.1";
const DEFAULT_TIMEOUT_MS = 10_000;
const DEFAULT_REFRESH_SECONDS = 900;

export interface ClientPricingRaw {
  inputCost?: number;
  outputCost?: number;
  cacheReadCost?: number;
  cacheWriteCost?: number;
  contextTiers?: Array<{
    maxContext?: number;
    rates?: {
      inputCost?: number;
      outputCost?: number;
      cacheReadCost?: number;
      cacheWriteCost?: number;
    };
  }>;
}

export interface ClientModelRaw {
  id: string;
  name?: string;
  aliases?: string[];
  display?: { label?: string; group?: string; order?: number };
  context_length?: number;
  maxOutputTokens?: number | null;
  inputModalities?: string[] | null;
  reasoningEfforts?: string[] | null;
  pricing?: ClientPricingRaw;
  minimumPlan?: string | null;
  hidden?: boolean;
  zdr?: boolean;
}

export interface ClientCatalogRaw {
  schemaVersion: number;
  catalogVersion: string;
  refreshAfterSeconds: number;
  data: ClientModelRaw[];
}

export interface PublicModelRaw {
  id: string;
  name?: string;
  context_length?: number;
  supported_endpoints?: string[];
  created?: number;
}

interface FetchResult {
  status: number;
  body?: unknown;
}

export class CatalogUnavailableError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "CatalogUnavailableError";
  }
}

export class CatalogHttpError extends Error {
  readonly status: number;

  constructor(status: number, url: string) {
    super(`CommandCode catalog request failed with HTTP ${status}: ${url}`);
    this.name = "CatalogHttpError";
    this.status = status;
  }
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

function asNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function asPositive(value: unknown): number | undefined {
  const number = asNumber(value);
  return number !== undefined && number > 0 ? number : undefined;
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string") : [];
}

function normalizeEfforts(value: unknown): CommandCodeEffort[] {
  const out: CommandCodeEffort[] = [];
  const seen = new Set<string>();
  for (const entry of asStringArray(value)) {
    if (!EFFORTS.has(entry as CommandCodeEffort) || seen.has(entry)) continue;
    seen.add(entry);
    out.push(entry as CommandCodeEffort);
  }
  return out;
}

function normalizeInput(value: unknown): ("text" | "image")[] {
  const modalities = new Set(asStringArray(value));
  const input: ("text" | "image")[] = ["text"];
  if (modalities.has("image")) input.push("image");
  return input;
}

function rates(raw: {
  inputCost?: number;
  outputCost?: number;
  cacheReadCost?: number;
  cacheWriteCost?: number;
} | undefined): Omit<CommandCodePricingTier, "inputTokensAbove"> {
  return {
    input: asNumber(raw?.inputCost) ?? 0,
    output: asNumber(raw?.outputCost) ?? 0,
    cacheRead: asNumber(raw?.cacheReadCost) ?? 0,
    cacheWrite: asNumber(raw?.cacheWriteCost) ?? 0,
  };
}

export function normalizePricing(raw: ClientPricingRaw | undefined): CommandCodePricing {
  const base = rates(raw);
  const tiers: CommandCodePricingTier[] = [];
  const contextTiers = Array.isArray(raw?.contextTiers) ? [...raw.contextTiers] : [];

  contextTiers.sort((a, b) => {
    const left = asPositive(a.maxContext) ?? Number.POSITIVE_INFINITY;
    const right = asPositive(b.maxContext) ?? Number.POSITIVE_INFINITY;
    return left - right;
  });

  for (let index = 1; index < contextTiers.length; index += 1) {
    const previous = contextTiers[index - 1];
    const threshold = asPositive(previous?.maxContext);
    if (threshold === undefined) continue;
    tiers.push({
      inputTokensAbove: threshold,
      ...rates(contextTiers[index]?.rates),
    });
  }

  return {
    ...base,
    tiers,
  };
}

function inferGroup(id: string): string {
  if (/^claude(?:[-.]|$)/i.test(id)) return "Anthropic";
  if (/^gpt-/i.test(id)) return "OpenAI";
  if (/^gemini/i.test(id)) return "Google";
  if (/^deepseek/i.test(id) || id.startsWith("deepseek/")) return "DeepSeek";
  if (/kimi/i.test(id)) return "Moonshot";
  if (/glm/i.test(id)) return "Z AI";
  if (/minimax/i.test(id)) return "MiniMax";
  if (/^qwen/i.test(id) || id.startsWith("Qwen/")) return "Alibaba";
  if (/^grok/i.test(id) || id.startsWith("xai/")) return "xAI";
  if (/^mistral/i.test(id)) return "Mistral AI";
  if (/^muse-/i.test(id) || id.startsWith("meta/")) return "Meta";
  if (/^nemotron/i.test(id)) return "NVIDIA";
  if (/^step-/i.test(id)) return "StepFun";
  return "Other";
}

function makeModel(input: {
  id: string;
  name: string;
  group: string;
  aliases?: string[];
  contextWindow: number;
  maxOutputTokens: number | null;
  input: ("text" | "image")[];
  efforts: CommandCodeEffort[];
  endpoints: string[];
  pricing: CommandCodePricing;
  minimumPlan: string | null;
  hidden: boolean;
  zdr: boolean;
  released?: number;
}): CommandCodeModel {
  const resolved = resolveProtocol({
    id: input.id,
    group: input.group,
    endpoints: input.endpoints,
  });

  const model: CommandCodeModel = {
    id: input.id,
    name: input.name,
    group: input.group,
    aliases: input.aliases ?? [],
    contextWindow: input.contextWindow,
    maxOutputTokens: input.maxOutputTokens,
    input: input.input,
    efforts: input.efforts,
    protocol: resolved.protocol,
    protocolReason: resolved.reason,
    endpoints: input.endpoints,
    pricing: input.pricing,
    minimumPlan: input.minimumPlan,
    hidden: input.hidden,
    zdr: input.zdr,
  };

  if (input.released !== undefined) model.released = input.released;
  return model;
}

export function mergeCatalog(
  client: ClientCatalogRaw,
  publicModels: readonly PublicModelRaw[],
  now = Date.now(),
): StoredCatalog {
  const publicById = new Map(publicModels.map((model) => [model.id, model]));
  const seen = new Set<string>();
  const models: CommandCodeModel[] = [];

  for (const raw of client.data) {
    if (!asString(raw.id) || seen.has(raw.id)) continue;
    seen.add(raw.id);
    const publicModel = publicById.get(raw.id);
    const group = asString(raw.display?.group) ?? inferGroup(raw.id);
    const endpoints = publicModel?.supported_endpoints ?? [];
    const contextWindow =
      asPositive(raw.context_length) ?? asPositive(publicModel?.context_length) ?? 128_000;
    const name = asString(raw.display?.label) ?? asString(raw.name) ?? raw.id;

    models.push(
      makeModel({
        id: raw.id,
        name,
        group,
        aliases: raw.aliases ?? [],
        contextWindow,
        maxOutputTokens: typeof raw.maxOutputTokens === "number" ? raw.maxOutputTokens : null,
        input: normalizeInput(raw.inputModalities),
        efforts: normalizeEfforts(raw.reasoningEfforts),
        endpoints,
        pricing: normalizePricing(raw.pricing),
        minimumPlan: raw.minimumPlan ?? null,
        hidden: raw.hidden === true,
        zdr: raw.zdr === true,
        ...(asNumber(publicModel?.created) !== undefined
          ? { released: (asNumber(publicModel?.created) ?? 0) * 1000 }
          : {}),
      }),
    );
  }

  for (const raw of publicModels) {
    if (seen.has(raw.id)) continue;
    seen.add(raw.id);
    const group = inferGroup(raw.id);
    const endpoints = raw.supported_endpoints ?? [];
    const contextWindow = asPositive(raw.context_length) ?? 128_000;
    models.push(
      makeModel({
        id: raw.id,
        name: asString(raw.name) ?? raw.id,
        group,
        contextWindow,
        maxOutputTokens: null,
        input: ["text"],
        efforts: [],
        endpoints,
        pricing: normalizePricing(undefined),
        minimumPlan: null,
        hidden: false,
        zdr: false,
        ...(asNumber(raw.created) !== undefined
          ? { released: (asNumber(raw.created) ?? 0) * 1000 }
          : {}),
      }),
    );
  }

  const catalogVersion = asString(client.catalogVersion);
  if (!catalogVersion) throw new CatalogUnavailableError("Catalog version is missing");

  return {
    schemaVersion: 1,
    catalogVersion,
    refreshAfterSeconds: asPositive(client.refreshAfterSeconds) ?? DEFAULT_REFRESH_SECONDS,
    fetchedAt: now,
    models,
  };
}

function parseClientCatalog(payload: unknown): ClientCatalogRaw {
  if (!payload || typeof payload !== "object") {
    throw new CatalogUnavailableError("Client catalog is not an object");
  }
  const body = payload as Partial<ClientCatalogRaw>;
  if (body.schemaVersion !== 1) {
    throw new CatalogUnavailableError(`Unsupported client catalog schema: ${body.schemaVersion}`);
  }
  const catalogVersion = asString(body.catalogVersion);
  if (!catalogVersion) {
    throw new CatalogUnavailableError("Client catalog version is missing");
  }
  if (!Array.isArray(body.data)) {
    throw new CatalogUnavailableError("Client catalog data is missing");
  }
  return {
    schemaVersion: 1,
    catalogVersion,
    refreshAfterSeconds: asPositive(body.refreshAfterSeconds) ?? DEFAULT_REFRESH_SECONDS,
    data: body.data,
  };
}

function parsePublicModels(payload: unknown): PublicModelRaw[] {
  if (!payload || typeof payload !== "object") return [];
  const data = (payload as { data?: unknown }).data;
  if (!Array.isArray(data)) return [];
  return data.filter(
    (entry): entry is PublicModelRaw =>
      Boolean(entry) && typeof entry === "object" && typeof (entry as PublicModelRaw).id === "string",
  );
}

function combineSignals(signal: AbortSignal | undefined, timeoutMs: number): AbortSignal {
  const timeout = AbortSignal.timeout(timeoutMs);
  if (!signal) return timeout;
  return AbortSignal.any([signal, timeout]);
}

async function fetchJson(
  url: string,
  options: {
    apiKey?: string;
    signal: AbortSignal;
    fetchImpl: typeof fetch;
    userAgent: string;
    etag?: string;
  },
): Promise<FetchResult> {
  const headers = new Headers({
    Accept: "application/json",
    "User-Agent": options.userAgent,
  });
  if (options.apiKey) headers.set("Authorization", `Bearer ${options.apiKey}`);
  if (options.etag) headers.set("If-None-Match", `"${options.etag}"`);

  const response = await options.fetchImpl(url, {
    headers,
    signal: options.signal,
  });

  if (response.status === 304) return { status: 304 };
  if (!response.ok) throw new CatalogHttpError(response.status, url);
  return { status: response.status, body: await response.json() };
}

function applyEndpoints(
  models: readonly CommandCodeModel[],
  publicModels: readonly PublicModelRaw[],
): CommandCodeModel[] {
  if (publicModels.length === 0) return [...models];
  const publicById = new Map(publicModels.map((model) => [model.id, model]));
  return models.map((model) => {
    const endpoints = publicById.get(model.id)?.supported_endpoints ?? model.endpoints;
    const resolved = resolveProtocol({
      id: model.id,
      group: model.group,
      endpoints,
    });
    return {
      ...model,
      endpoints,
      protocol: resolved.protocol,
      protocolReason: resolved.reason,
    };
  });
}

export async function loadCatalog(options: LoadCatalogOptions = {}): Promise<StoredCatalog> {
  const now = options.now?.() ?? Date.now();
  const baseUrl = (options.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, "");
  const fetchImpl = options.fetchImpl ?? fetch;
  const userAgent = options.userAgent ?? DEFAULT_USER_AGENT;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const cached = await options.store?.read();

  if (
    cached &&
    !options.force &&
    options.allowNetwork !== false &&
    now - cached.fetchedAt < cached.refreshAfterSeconds * 1000
  ) {
    return cached;
  }

  if (options.allowNetwork === false) {
    if (cached) return cached;
    throw new CatalogUnavailableError("No cached CommandCode catalog is available");
  }

  const signal = combineSignals(options.signal, timeoutMs);
  const [clientResult, publicResult] = await Promise.allSettled([
    fetchJson(`${baseUrl}/models?view=client`, {
      ...(options.apiKey ? { apiKey: options.apiKey } : {}),
      signal,
      fetchImpl,
      userAgent,
      ...(cached ? { etag: cached.catalogVersion } : {}),
    }),
    fetchJson(`${baseUrl}/models`, {
      ...(options.apiKey ? { apiKey: options.apiKey } : {}),
      signal,
      fetchImpl,
      userAgent,
    }),
  ]);

  const publicModels =
    publicResult.status === "fulfilled" && publicResult.value.body !== undefined
      ? parsePublicModels(publicResult.value.body)
      : [];

  let parseError: unknown;

  if (clientResult.status === "fulfilled") {
    if (clientResult.value.status === 304 && cached) {
      const refreshed = {
        ...cached,
        fetchedAt: now,
        models: applyEndpoints(cached.models, publicModels),
      };
      await options.store?.write(refreshed).catch(() => undefined);
      return refreshed;
    }

    if (clientResult.value.body !== undefined) {
      try {
        const client = parseClientCatalog(clientResult.value.body);
        const merged = mergeCatalog(client, publicModels, now);
        await options.store?.write(merged).catch(() => undefined);
        return merged;
      } catch (error) {
        parseError = error;
      }
    }
  }

  if (cached) {
    const refreshed = {
      ...cached,
      fetchedAt: now,
      models: applyEndpoints(cached.models, publicModels),
    };
    await options.store?.write(refreshed).catch(() => undefined);
    return refreshed;
  }

  const reason =
    clientResult.status === "rejected"
      ? clientResult.reason
      : (parseError ?? "Client catalog was empty");
  throw new CatalogUnavailableError("Unable to load the CommandCode catalog", { cause: reason });
}
