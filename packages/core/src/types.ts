export type CommandCodeEffort = "off" | "low" | "medium" | "high" | "xhigh" | "max";

export type CommandCodeProtocol = "openai-chat" | "openai-responses" | "anthropic-messages";

export interface CommandCodePricingTier {
  inputTokensAbove: number;
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
}

export interface CommandCodePricing {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  tiers: CommandCodePricingTier[];
}

export interface CommandCodeModel {
  id: string;
  name: string;
  group: string;
  aliases: string[];
  contextWindow: number;
  maxOutputTokens: number | null;
  input: ("text" | "image")[];
  efforts: CommandCodeEffort[];
  protocol: CommandCodeProtocol;
  protocolReason: string;
  endpoints: string[];
  pricing: CommandCodePricing;
  minimumPlan: string | null;
  hidden: boolean;
  zdr: boolean;
  released?: number;
}

export interface StoredCatalog {
  schemaVersion: 1;
  catalogVersion: string;
  refreshAfterSeconds: number;
  fetchedAt: number;
  models: CommandCodeModel[];
}

export interface CatalogStore {
  read(): Promise<StoredCatalog | undefined>;
  write(value: StoredCatalog): Promise<void>;
}

export interface LoadCatalogOptions {
  apiKey?: string;
  store?: CatalogStore;
  signal?: AbortSignal;
  allowNetwork?: boolean;
  force?: boolean;
  fetchImpl?: typeof fetch;
  now?: () => number;
  timeoutMs?: number;
  baseUrl?: string;
  userAgent?: string;
}

export interface ResolveProtocolInput {
  id: string;
  group?: string;
  endpoints?: string[];
}

export interface ResolveProtocolResult {
  protocol: CommandCodeProtocol;
  reason: string;
}

export interface OpenCodeVariant {
  id: string;
  settings: Record<string, unknown>;
}
