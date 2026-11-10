import assert from "node:assert/strict";
import test from "node:test";

import type { CommandCodeModel } from "commandcode-integrations-core";

import {
  openCodePackageForProtocol,
  toOpenCodeCost,
  toOpenCodeModelFields,
} from "../src/model.ts";

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

test("OpenCode package follows the protocol", () => {
  assert.equal(
    openCodePackageForProtocol("openai-chat"),
    "@opencode/ai/providers/openai-compatible",
  );
  assert.equal(
    openCodePackageForProtocol("openai-responses"),
    "@opencode/ai/providers/openai-compatible/responses",
  );
  assert.equal(
    openCodePackageForProtocol("anthropic-messages"),
    "@opencode/ai/providers/anthropic-compatible",
  );
});

test("OpenCode model fields map capabilities, cost, and variants", () => {
  const fields = toOpenCodeModelFields(model(), 32_768);
  assert.equal(fields.name, "DeepSeek V4.1 Flash");
  assert.equal(fields.package, "@opencode/ai/providers/openai-compatible");
  assert.deepEqual(fields.capabilities, {
    tools: true,
    input: ["text", "image"],
    output: ["text"],
  });
  assert.deepEqual(fields.variants, [
    { id: "none", settings: { reasoningEffort: "off" } },
    { id: "low", settings: { reasoningEffort: "low" } },
    { id: "high", settings: { reasoningEffort: "high" } },
    { id: "max", settings: { reasoningEffort: "max" } },
  ]);
  assert.deepEqual(fields.cost, [
    { input: 0.15, output: 0.6, cache: { read: 0.003, write: 0 } },
  ]);
  assert.deepEqual(fields.limit, { context: 1_000_000, output: 32_768 });
});

test("OpenCode Anthropic variants use thinking settings", () => {
  const fields = toOpenCodeModelFields(
    model({
      id: "claude-sonnet-5-5",
      group: "Anthropic",
      protocol: "anthropic-messages",
      efforts: ["low", "medium", "high", "xhigh", "max"],
      endpoints: ["/messages"],
    }),
    32_768,
  );

  assert.equal(fields.package, "@opencode/ai/providers/anthropic-compatible");
  assert.deepEqual(fields.variants[0], {
    id: "low",
    settings: { thinking: { type: "adaptive", display: "summarized" }, effort: "low" },
  });
});

test("OpenCode Responses variants map off to none", () => {
  const fields = toOpenCodeModelFields(
    model({
      protocol: "openai-responses",
      efforts: ["off", "high"],
      endpoints: ["/responses"],
    }),
    32_768,
  );

  assert.equal(
    fields.package,
    "@opencode/ai/providers/openai-compatible/responses",
  );
  assert.deepEqual(fields.variants, [
    { id: "none", settings: { reasoningEffort: "none" } },
    { id: "high", settings: { reasoningEffort: "high" } },
  ]);
});

test("OpenCode cost tiers become context tiers", () => {
  const cost = toOpenCodeCost({
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

  assert.deepEqual(cost, [
    { input: 0.4, output: 1.6, cache: { read: 0.08, write: 0.5 } },
    {
      tier: { type: "context", size: 256_000 },
      input: 1.2,
      output: 4.8,
      cache: { read: 0.24, write: 1.5 },
    },
  ]);
});
