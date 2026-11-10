import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  FileCatalogStore,
  loadCatalog,
  mergeCatalog,
  normalizePricing,
  resolveCommandCodeKey,
  resolveProtocol,
  toOpenCodeVariants,
  toPiThinkingMap,
} from "../src/index.ts";
import type { CatalogStore, ClientCatalogRaw, StoredCatalog } from "../src/index.ts";

interface RoutingFixture {
  id: string;
  group: string;
  endpoints: string[];
  efforts: string[];
}

const routingFixtures: RoutingFixture[] = JSON.parse(
  readFileSync(join(import.meta.dirname, "fixtures", "models.json"), "utf8"),
) as RoutingFixture[];

function clientPayload(data: ClientCatalogRaw["data"]): ClientCatalogRaw {
  return {
    schemaVersion: 1,
    catalogVersion: "test-catalog",
    refreshAfterSeconds: 900,
    data,
  };
}

function memoryStore(initial?: StoredCatalog): CatalogStore & { value: StoredCatalog | undefined } {
  const store = {
    value: initial,
    async read() {
      return store.value;
    },
    async write(next: StoredCatalog) {
      store.value = next;
    },
  };
  return store;
}

test("chat-first protocol routing matches the public catalog", () => {
  const counts = { "anthropic-messages": 0, "openai-chat": 0, "openai-responses": 0 };

  for (const model of routingFixtures) {
    const result = resolveProtocol({
      id: model.id,
      group: model.group,
      endpoints: model.endpoints,
    });
    counts[result.protocol] += 1;
  }

  assert.deepEqual(counts, {
    "anthropic-messages": 12,
    "openai-chat": 85,
    "openai-responses": 0,
  });
});

test("protocol routing rules", () => {
  assert.equal(
    resolveProtocol({ id: "claude-sonnet-5-5", group: "Anthropic", endpoints: ["/messages"] })
      .protocol,
    "anthropic-messages",
  );
  assert.equal(
    resolveProtocol({
      id: "deepseek/deepseek-v4.1-flash",
      group: "DeepSeek",
      endpoints: ["/chat/completions", "/responses"],
    }).protocol,
    "openai-chat",
  );
  assert.equal(
    resolveProtocol({
      id: "deepseek/deepseek-v4-flash-fast",
      group: "DeepSeek",
      endpoints: ["/chat/completions"],
    }).protocol,
    "openai-chat",
  );
  assert.equal(
    resolveProtocol({
      id: "future/responses-only",
      group: "Other",
      endpoints: ["/responses"],
    }).protocol,
    "openai-responses",
  );
  assert.equal(
    resolveProtocol({
      id: "future/messages-only",
      group: "Other",
      endpoints: ["/messages"],
    }).protocol,
    "anthropic-messages",
  );
  assert.equal(
    resolveProtocol({ id: "future/unknown", group: "Other", endpoints: [] }).protocol,
    "openai-chat",
  );
});

test("Pi thinking map follows catalog efforts", () => {
  assert.deepEqual(toPiThinkingMap(["off", "low", "high", "max"], "openai-chat"), {
    off: "off",
    minimal: "low",
    low: "low",
    medium: null,
    high: "high",
    xhigh: null,
    max: "max",
  });

  assert.deepEqual(toPiThinkingMap(["off", "low", "high", "max"], "openai-responses"), {
    off: "none",
    minimal: "low",
    low: "low",
    medium: null,
    high: "high",
    xhigh: null,
    max: "max",
  });

  assert.deepEqual(toPiThinkingMap(["low", "medium", "high", "max"], "anthropic-messages"), {
    off: null,
    minimal: "low",
    low: "low",
    medium: "medium",
    high: "high",
    xhigh: null,
    max: "max",
  });

  assert.deepEqual(toPiThinkingMap([], "openai-chat"), {
    off: null,
    minimal: null,
    low: null,
    medium: null,
    high: null,
    xhigh: null,
    max: null,
  });
});

test("OpenCode variants map off per protocol", () => {
  assert.deepEqual(toOpenCodeVariants(["off", "high"], "openai-chat"), [
    { id: "none", settings: { reasoningEffort: "off" } },
    { id: "high", settings: { reasoningEffort: "high" } },
  ]);

  assert.deepEqual(toOpenCodeVariants(["off", "high"], "openai-responses"), [
    { id: "none", settings: { reasoningEffort: "none" } },
    { id: "high", settings: { reasoningEffort: "high" } },
  ]);

  assert.deepEqual(toOpenCodeVariants(["low", "high"], "anthropic-messages"), [
    {
      id: "low",
      settings: { thinking: { type: "adaptive", display: "summarized" }, effort: "low" },
    },
    {
      id: "high",
      settings: { thinking: { type: "adaptive", display: "summarized" }, effort: "high" },
    },
  ]);

  assert.deepEqual(toOpenCodeVariants(["off"], "anthropic-messages"), [
    { id: "none", settings: { thinking: { type: "disabled" } } },
  ]);
});

test("pricing maps context tiers to input thresholds", () => {
  const qwen = normalizePricing({
    inputCost: 0.4,
    outputCost: 1.6,
    cacheReadCost: 0.08,
    cacheWriteCost: 0.5,
    contextTiers: [
      {
        maxContext: 256000,
        rates: { inputCost: 0.4, outputCost: 1.6, cacheReadCost: 0.08, cacheWriteCost: 0.5 },
      },
      {
        rates: { inputCost: 1.2, outputCost: 4.8, cacheReadCost: 0.24, cacheWriteCost: 1.5 },
      },
    ],
  });

  assert.deepEqual(qwen, {
    input: 0.4,
    output: 1.6,
    cacheRead: 0.08,
    cacheWrite: 0.5,
    tiers: [
      { inputTokensAbove: 256000, input: 1.2, output: 4.8, cacheRead: 0.24, cacheWrite: 1.5 },
    ],
  });

  const flash = normalizePricing({
    inputCost: 0.03,
    outputCost: 0.13,
    cacheReadCost: 0.006,
    cacheWriteCost: 0.038,
    contextTiers: [
      {
        maxContext: 32000,
        rates: { inputCost: 0.03, outputCost: 0.13, cacheReadCost: 0.006, cacheWriteCost: 0.038 },
      },
      {
        maxContext: 256000,
        rates: { inputCost: 0.1, outputCost: 0.4, cacheReadCost: 0.02, cacheWriteCost: 0.125 },
      },
      {
        rates: { inputCost: 0.2, outputCost: 0.8, cacheReadCost: 0.04, cacheWriteCost: 0.25 },
      },
    ],
  });

  assert.deepEqual(flash.tiers, [
    { inputTokensAbove: 32000, input: 0.1, output: 0.4, cacheRead: 0.02, cacheWrite: 0.125 },
    { inputTokensAbove: 256000, input: 0.2, output: 0.8, cacheRead: 0.04, cacheWrite: 0.25 },
  ]);

  assert.deepEqual(normalizePricing(undefined), {
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
    tiers: [],
  });
});

test("mergeCatalog joins client capabilities with public endpoints", () => {
  const merged = mergeCatalog(
    clientPayload([
      {
        id: "deepseek/deepseek-v4.1-flash",
        name: "DeepSeek V4.1 Flash",
        display: { label: "DeepSeek V4.1 Flash", group: "DeepSeek" },
        context_length: 1000000,
        maxOutputTokens: null,
        inputModalities: ["text", "image"],
        reasoningEfforts: ["off", "low", "high", "max"],
        pricing: { inputCost: 0.15, outputCost: 0.6, cacheReadCost: 0.003, cacheWriteCost: 0 },
        minimumPlan: "individual-go",
        hidden: false,
        zdr: true,
      },
      {
        id: "client/only",
        name: "Client Only",
        display: { label: "Client Only", group: "Other" },
        context_length: 128000,
        reasoningEfforts: [],
        hidden: true,
      },
    ]),
    [
      {
        id: "deepseek/deepseek-v4.1-flash",
        name: "DeepSeek",
        context_length: 1000000,
        supported_endpoints: ["/chat/completions", "/responses"],
        created: 1794302189,
      },
      {
        id: "public/only",
        name: "Public Only",
        context_length: 64000,
        supported_endpoints: ["/chat/completions"],
      },
    ],
    1234,
  );

  assert.equal(merged.catalogVersion, "test-catalog");
  assert.equal(merged.refreshAfterSeconds, 900);
  assert.equal(merged.fetchedAt, 1234);
  assert.equal(merged.models.length, 3);

  const deepseek = merged.models.find((model) => model.id === "deepseek/deepseek-v4.1-flash");
  assert.ok(deepseek);
  assert.equal(deepseek.protocol, "openai-chat");
  assert.deepEqual(deepseek.efforts, ["off", "low", "high", "max"]);
  assert.deepEqual(deepseek.input, ["text", "image"]);
  assert.equal(deepseek.zdr, true);
  assert.equal(deepseek.released, 1794302189000);

  const publicOnly = merged.models.find((model) => model.id === "public/only");
  assert.ok(publicOnly);
  assert.equal(publicOnly.protocol, "openai-chat");
  assert.deepEqual(publicOnly.efforts, []);

  const clientOnly = merged.models.find((model) => model.id === "client/only");
  assert.ok(clientOnly);
  assert.equal(clientOnly.hidden, true);
  assert.equal(clientOnly.protocol, "openai-chat");
});

test("resolveCommandCodeKey prefers environment then provider auth then CLI auth", () => {
  const home = mkdtempSync(join(tmpdir(), "commandcode-auth-"));
  try {
    mkdirSync(join(home, ".pi", "agent", "commandcode"), { recursive: true });
    writeFileSync(
      join(home, ".pi", "agent", "commandcode", "auth.json"),
      JSON.stringify({ apiKeys: ["provider-key"] }),
    );
    mkdirSync(join(home, ".commandcode"), { recursive: true });
    writeFileSync(join(home, ".commandcode", "auth.json"), JSON.stringify({ apiKey: "cli-key" }));

    assert.equal(resolveCommandCodeKey({ home, env: {} }), "provider-key");
    assert.equal(
      resolveCommandCodeKey({ home, env: { COMMANDCODE_API_KEY: "env-key" } }),
      "env-key",
    );

    rmSync(join(home, ".pi"), { recursive: true, force: true });
    assert.equal(resolveCommandCodeKey({ home, env: {} }), "cli-key");

    rmSync(join(home, ".commandcode"), { recursive: true, force: true });
    assert.equal(resolveCommandCodeKey({ home, env: {} }), null);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("loadCatalog uses cache, revalidates, and survives network failure", async () => {
  const client = clientPayload([
    {
      id: "deepseek/deepseek-v4.1-flash",
      name: "DeepSeek",
      display: { label: "DeepSeek", group: "DeepSeek" },
      context_length: 1000000,
      reasoningEfforts: ["off", "low", "high", "max"],
    },
  ]);
  const publicModels = {
    object: "list",
    data: [
      {
        id: "deepseek/deepseek-v4.1-flash",
        name: "DeepSeek",
        supported_endpoints: ["/chat/completions", "/responses"],
      },
    ],
  };

  let calls = 0;
  const fetchImpl: typeof fetch = async (input) => {
    calls += 1;
    const url = String(input);
    const body = url.includes("view=client") ? client : publicModels;
    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };

  const store = memoryStore();
  const first = await loadCatalog({ store, fetchImpl, now: () => 1000 });
  assert.equal(first.models[0]?.protocol, "openai-chat");
  assert.equal(calls, 2);

  calls = 0;
  const cached = await loadCatalog({ store, fetchImpl, now: () => 2000 });
  assert.equal(cached.fetchedAt, 1000);
  assert.equal(calls, 0);

  const offline = await loadCatalog({ store, allowNetwork: false, now: () => 3000 });
  assert.equal(offline.catalogVersion, "test-catalog");

  const failingFetch: typeof fetch = async () => {
    throw new Error("network down");
  };
  const stale = await loadCatalog({ store, fetchImpl: failingFetch, now: () => 4000, force: true });
  assert.equal(stale.fetchedAt, 4000);
  assert.equal(stale.models.length, 1);

  await assert.rejects(
    () => loadCatalog({ fetchImpl: failingFetch, now: () => 5000 }),
    /Unable to load the CommandCode catalog/,
  );
});

test("loadCatalog keeps the cache when the client schema is invalid", async () => {
  const cached = mergeCatalog(
    clientPayload([
      {
        id: "deepseek/deepseek-v4.1-flash",
        name: "DeepSeek",
        display: { label: "DeepSeek", group: "DeepSeek" },
        context_length: 1000000,
        reasoningEfforts: ["off", "low", "high", "max"],
      },
    ]),
    [
      {
        id: "deepseek/deepseek-v4.1-flash",
        supported_endpoints: ["/chat/completions"],
      },
    ],
    1000,
  );

  const store = memoryStore(cached);
  const fetchImpl: typeof fetch = async (input) => {
    const url = String(input);
    const body = url.includes("view=client") ? { schemaVersion: 2 } : { data: [] };
    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };

  const result = await loadCatalog({ store, fetchImpl, now: () => 2000, force: true });
  assert.equal(result.catalogVersion, "test-catalog");
  assert.equal(result.models.length, 1);
  assert.equal(result.fetchedAt, 2000);
});

test("FileCatalogStore round-trips and rejects corrupt data", async () => {
  const home = mkdtempSync(join(tmpdir(), "commandcode-store-"));
  const path = join(home, "catalog.json");
  try {
    const store = new FileCatalogStore(path);
    const catalog = mergeCatalog(
      clientPayload([
        {
          id: "deepseek/deepseek-v4.1-flash",
          name: "DeepSeek",
          display: { label: "DeepSeek", group: "DeepSeek" },
          context_length: 1000000,
          reasoningEfforts: [],
        },
      ]),
      [],
      1000,
    );

    await store.write(catalog);
    assert.equal((await store.read())?.catalogVersion, "test-catalog");

    writeFileSync(path, "{}");
    assert.equal(await store.read(), undefined);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});
