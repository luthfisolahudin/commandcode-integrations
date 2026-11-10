import assert from "node:assert/strict";
import test from "node:test";

import type { CommandCodeModel } from "commandcode-integrations-core";

import { piApiForProtocol, providerBaseUrl, toPiCost, toPiModel } from "../src/model.ts";

function model(overrides: Partial<CommandCodeModel> = {}): CommandCodeModel {
  return {
    id: "deepseek/deepseek-v4.1-flash",
    name: "DeepSeek V4.1 Flash",
    group: "DeepSeek",
    aliases: [],
    contextWindow: 1_000_000,
    maxOutputTokens: null,
    input: ["text", "image"],
    efforts: ["off", "low", "high", "max"],
    protocol: "openai-chat",
    protocolReason: "chat-supported",
    endpoints: ["/chat/completions", "/responses"],
    pricing: {
      input: 0.15,
      output: 0.6,
      cacheRead: 0.003,
      cacheWrite: 0,
      tiers: [],
    },
    minimumPlan: "individual-go",
    hidden: false,
    zdr: true,
    ...overrides,
  };
}

test("Pi API follows the protocol", () => {
  assert.equal(piApiForProtocol("openai-chat"), "openai-completions");
  assert.equal(piApiForProtocol("openai-responses"), "openai-responses");
  assert.equal(piApiForProtocol("anthropic-messages"), "anthropic-messages");
});

test("Pi chat model maps thinking levels and compatibility", () => {
  const mapped = toPiModel(model(), "https://api.commandcode.ai/provider/v1");

  assert.equal(mapped.api, "openai-completions");
  assert.equal(mapped.provider, "commandcode");
  assert.equal(mapped.baseUrl, "https://api.commandcode.ai/provider/v1");
  assert.equal(mapped.reasoning, true);
  assert.deepEqual(mapped.thinkingLevelMap, {
    off: "off",
    minimal: "low",
    low: "low",
    medium: null,
    high: "high",
    xhigh: null,
    max: "max",
  });
  assert.deepEqual(mapped.cost, {
    input: 0.15,
    output: 0.6,
    cacheRead: 0.003,
    cacheWrite: 0,
  });
  assert.equal(mapped.maxTokens, 32_768);
  assert.deepEqual(mapped.compat, {
    supportsReasoningEffort: true,
    thinkingFormat: "openai",
    maxTokensField: "max_tokens",
    supportsUsageInStreaming: true,
  });
});

test("Pi Anthropic model uses adaptive thinking", () => {
  const mapped = toPiModel(
    model({
      id: "claude-sonnet-5-5",
      group: "Anthropic",
      protocol: "anthropic-messages",
      efforts: ["low", "medium", "high", "xhigh", "max"],
      endpoints: ["/messages"],
    }),
    "https://api.commandcode.ai/provider/v1",
  );

  assert.equal(mapped.api, "anthropic-messages");
  assert.equal(mapped.baseUrl, "https://api.commandcode.ai/provider");
  assert.deepEqual(mapped.thinkingLevelMap, {
    off: null,
    minimal: "low",
    low: "low",
    medium: "medium",
    high: "high",
    xhigh: "xhigh",
    max: "max",
  });
  assert.deepEqual(mapped.compat, { forceAdaptiveThinking: true });
});

test("Pi responses model maps off to none", () => {
  const mapped = toPiModel(
    model({
      protocol: "openai-responses",
      efforts: ["off", "high"],
      endpoints: ["/responses"],
    }),
    "https://api.commandcode.ai/provider/v1",
  );

  assert.equal(mapped.api, "openai-responses");
  assert.equal(mapped.thinkingLevelMap?.off, "none");
  assert.equal(mapped.compat, undefined);
});

test("Pi non-reasoning model has no thinking map", () => {
  const mapped = toPiModel(model({ efforts: [] }), "https://api.commandcode.ai/provider/v1");
  assert.equal(mapped.reasoning, false);
  assert.equal(mapped.thinkingLevelMap, undefined);
});

test("Pi cost maps context tiers", () => {
  const cost = toPiCost({
    input: 0.4,
    output: 1.6,
    cacheRead: 0.08,
    cacheWrite: 0.5,
    tiers: [
      {
        inputTokensAbove: 256_000,
        input: 1.2,
        output: 4.8,
        cacheRead: 0.24,
        cacheWrite: 1.5,
      },
    ],
  });

  assert.deepEqual(cost.tiers, [
    {
      input: 1.2,
      output: 4.8,
      cacheRead: 0.24,
      cacheWrite: 1.5,
      inputTokensAbove: 256_000,
    },
  ]);
});

test("providerBaseUrl strips trailing slashes", () => {
  assert.equal(
    providerBaseUrl("https://api.commandcode.ai/provider/v1///"),
    "https://api.commandcode.ai/provider/v1",
  );
});
