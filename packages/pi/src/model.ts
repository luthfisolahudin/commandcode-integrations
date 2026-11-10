import type { Api, Model, ModelCost } from "@earendil-works/pi-ai";
import type { CommandCodeModel, CommandCodePricing } from "commandcode-integrations-core";
import { toPiThinkingMap } from "commandcode-integrations-core";

export type PiApi = "openai-completions" | "openai-responses" | "anthropic-messages";

const DEFAULT_MAX_TOKENS = 32_768;
const USER_AGENT = "commandcode-integrations/0.1";

export function piApiForProtocol(protocol: CommandCodeModel["protocol"]): PiApi {
  switch (protocol) {
    case "openai-chat":
      return "openai-completions";
    case "openai-responses":
      return "openai-responses";
    case "anthropic-messages":
      return "anthropic-messages";
  }
}

export function toPiCost(pricing: CommandCodePricing): ModelCost {
  const cost: ModelCost = {
    input: pricing.input,
    output: pricing.output,
    cacheRead: pricing.cacheRead,
    cacheWrite: pricing.cacheWrite,
  };

  if (pricing.tiers.length > 0) {
    cost.tiers = pricing.tiers.map((tier) => ({
      input: tier.input,
      output: tier.output,
      cacheRead: tier.cacheRead,
      cacheWrite: tier.cacheWrite,
      inputTokensAbove: tier.inputTokensAbove,
    }));
  }

  return cost;
}

function compatForModel(model: CommandCodeModel): unknown {
  if (model.protocol === "openai-chat") {
    return {
      supportsReasoningEffort: true,
      thinkingFormat: "openai",
      maxTokensField: "max_tokens",
      supportsUsageInStreaming: true,
    };
  }

  if (model.protocol === "anthropic-messages" && model.efforts.length > 0) {
    return { forceAdaptiveThinking: true };
  }

  return undefined;
}

export function toPiModel(model: CommandCodeModel, baseUrl: string): Model<PiApi> {
  const api = piApiForProtocol(model.protocol);
  const compat = compatForModel(model);

  return {
    id: model.id,
    name: model.name,
    api,
    provider: "commandcode",
    baseUrl: piBaseUrlForProtocol(model.protocol, baseUrl),
    input: [...model.input],
    cost: toPiCost(model.pricing),
    reasoning: model.efforts.length > 0,
    ...(model.efforts.length > 0
      ? { thinkingLevelMap: toPiThinkingMap(model.efforts, model.protocol) }
      : {}),
    contextWindow: model.contextWindow,
    maxTokens: model.maxOutputTokens ?? DEFAULT_MAX_TOKENS,
    ...(compat ? { compat: compat as never } : {}),
    headers: { "User-Agent": USER_AGENT },
  };
}

export function providerBaseUrl(baseUrl?: string): string {
  return (baseUrl ?? "https://api.commandcode.ai/provider/v1").replace(/\/+$/, "");
}

/** Anthropic's SDK appends `/v1/messages`, so its base URL must not include `/v1`. */
export function piBaseUrlForProtocol(
  protocol: CommandCodeModel["protocol"],
  baseUrl: string,
): string {
  const normalized = providerBaseUrl(baseUrl);
  if (protocol === "anthropic-messages" && normalized.endsWith("/v1")) {
    return normalized.slice(0, -3);
  }
  return normalized;
}
