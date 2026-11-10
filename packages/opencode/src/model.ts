import { toOpenCodeVariants } from "commandcode-integrations-core";
import type { CommandCodeModel, CommandCodePricing } from "commandcode-integrations-core";

export const OPENCODE_PACKAGES = {
  "openai-chat": "@opencode/ai/providers/openai-compatible",
  "openai-responses": "@opencode/ai/providers/openai-compatible/responses",
  "anthropic-messages": "@opencode/ai/providers/anthropic-compatible",
} as const;

export interface OpenCodeCost {
  tier?: { type: "context"; size: number };
  input: number;
  output: number;
  cache: { read: number; write: number };
}

export interface OpenCodeModelFields {
  name: string;
  package: string;
  capabilities: {
    tools: boolean;
    input: string[];
    output: string[];
  };
  variants: Array<{ id: string; settings: Record<string, unknown> }>;
  cost: OpenCodeCost[];
  limit: { context: number; output: number };
  status: "active";
  enabled: boolean;
}

export function openCodePackageForProtocol(protocol: CommandCodeModel["protocol"]): string {
  return OPENCODE_PACKAGES[protocol];
}

export function toOpenCodeCost(pricing: CommandCodePricing): OpenCodeCost[] {
  const base: OpenCodeCost = {
    input: pricing.input,
    output: pricing.output,
    cache: { read: pricing.cacheRead, write: pricing.cacheWrite },
  };

  const tiers = pricing.tiers.map((tier) => ({
    tier: { type: "context" as const, size: tier.inputTokensAbove },
    input: tier.input,
    output: tier.output,
    cache: { read: tier.cacheRead, write: tier.cacheWrite },
  }));

  return [base, ...tiers];
}

export function toOpenCodeModelFields(
  model: CommandCodeModel,
  defaultMaxOutput: number,
): OpenCodeModelFields {
  return {
    name: model.name,
    package: openCodePackageForProtocol(model.protocol),
    capabilities: {
      tools: true,
      input: [...model.input],
      output: ["text"],
    },
    variants: toOpenCodeVariants(model.efforts, model.protocol),
    cost: toOpenCodeCost(model.pricing),
    limit: {
      context: model.contextWindow,
      output: model.maxOutputTokens ?? defaultMaxOutput,
    },
    status: "active",
    enabled: true,
  };
}
