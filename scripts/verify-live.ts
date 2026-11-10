import {
  FileCatalogStore,
  loadCatalog,
  resolveCommandCodeKey,
} from "../packages/core/src/index.ts";
import type { CommandCodeModel } from "../packages/core/src/index.ts";

const API_KEY = resolveCommandCodeKey();
const BASE_URL = (process.env.COMMANDCODE_BASE_URL ?? "https://api.commandcode.ai/provider/v1").replace(
  /\/+$/,
  "",
);
const USER_AGENT = "commandcode-integrations/0.1";
const PROMPT =
  "How many integer solutions does x1+x2+x3+x4=20 have with each xi >= 0 and xi <= 7? Give just the number.";

if (!API_KEY) {
  console.error("No CommandCode API key found in COMMANDCODE_API_KEY, provider auth, or CLI auth.");
  process.exit(1);
}

function planRank(model: CommandCodeModel): number {
  switch (model.minimumPlan) {
    case "individual-go":
      return 0;
    case "individual-goat":
      return 1;
    case "individual-pro":
      return 2;
    case "individual-provider":
      return 3;
    case "individual-max":
      return 4;
    default:
      return 5;
  }
}

function highestEffort(model: CommandCodeModel): string {
  const order = ["off", "low", "medium", "high", "xhigh", "max"];
  const available = new Set(model.efforts);
  for (const effort of [...order].reverse()) {
    if (available.has(effort as CommandCodeModel["efforts"][number])) return effort;
  }
  return "high";
}

async function request(path: string, body: unknown): Promise<{ status: number; json: unknown }> {
  const response = await fetch(`${BASE_URL}${path}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${API_KEY}`,
      "Content-Type": "application/json",
      "User-Agent": USER_AGENT,
    },
    body: JSON.stringify(body),
  });
  let json: unknown = undefined;
  try {
    json = await response.json();
  } catch {
    // Non-JSON error bodies are reported by status only.
  }
  return { status: response.status, json };
}

function errorMessage(json: unknown): string {
  if (!json || typeof json !== "object") return "";
  const error = (json as { error?: { message?: string } }).error;
  return error?.message?.slice(0, 120) ?? "";
}

function reasoningTokens(json: unknown): number | null {
  if (!json || typeof json !== "object") return null;
  const usage = (json as {
    usage?: {
      completion_tokens_details?: { reasoning_tokens?: number };
      output_tokens_details?: { reasoning_tokens?: number; thinking_tokens?: number };
    };
  }).usage;
  return (
    usage?.completion_tokens_details?.reasoning_tokens ??
    usage?.output_tokens_details?.reasoning_tokens ??
    usage?.output_tokens_details?.thinking_tokens ??
    null
  );
}

function toolName(json: unknown): string | null {
  if (!json || typeof json !== "object") return null;
  const body = json as {
    choices?: Array<{ message?: { tool_calls?: Array<{ function?: { name?: string } }> } }>;
    output?: Array<{ type?: string; name?: string }>;
    content?: Array<{ type?: string; name?: string }>;
  };
  return (
    body.choices?.[0]?.message?.tool_calls?.[0]?.function?.name ??
    body.output?.find((entry) => entry.type === "function_call")?.name ??
    body.content?.find((entry) => entry.type === "tool_use")?.name ??
    null
  );
}

async function testReasoning(model: CommandCodeModel): Promise<boolean> {
  const effort = highestEffort(model);
  if (model.protocol === "openai-chat") {
    const result = await request("/chat/completions", {
      model: model.id,
      messages: [{ role: "user", content: PROMPT }],
      max_tokens: 512,
      reasoning_effort: effort,
    });
    console.log(
      `${model.id}\tchat\t${effort}\t${result.status}\t${reasoningTokens(result.json) ?? "-"}\t${errorMessage(result.json)}`,
    );
    return result.status === 200;
  }

  if (model.protocol === "openai-responses") {
    const result = await request("/responses", {
      model: model.id,
      input: PROMPT,
      max_output_tokens: 512,
      reasoning: { effort: effort === "off" ? "none" : effort },
    });
    console.log(
      `${model.id}\tresponses\t${effort}\t${result.status}\t${reasoningTokens(result.json) ?? "-"}\t${errorMessage(result.json)}`,
    );
    return result.status === 200;
  }

  const result = await request("/messages", {
    model: model.id,
    max_tokens: 512,
    messages: [{ role: "user", content: PROMPT }],
    thinking: effort === "off" ? { type: "disabled" } : { type: "adaptive", display: "summarized" },
    ...(effort !== "off" ? { output_config: { effort } } : {}),
  });
  console.log(
    `${model.id}\tmessages\t${effort}\t${result.status}\t${reasoningTokens(result.json) ?? "-"}\t${errorMessage(result.json)}`,
  );
  return result.status === 200;
}

async function testTool(model: CommandCodeModel): Promise<boolean> {
  if (model.protocol === "openai-chat") {
    const result = await request("/chat/completions", {
      model: model.id,
      messages: [{ role: "user", content: "What is the weather in Jakarta? Use the get_weather tool." }],
      max_tokens: 256,
      tools: [
        {
          type: "function",
          function: {
            name: "get_weather",
            description: "Get current weather",
            parameters: { type: "object", properties: { city: { type: "string" } }, required: ["city"] },
          },
        },
      ],
      tool_choice: "auto",
    });
    console.log(`${model.id}\ttool-chat\t${result.status}\t${toolName(result.json) ?? "-"}\t${errorMessage(result.json)}`);
    return result.status === 200 && toolName(result.json) === "get_weather";
  }

  if (model.protocol === "openai-responses") {
    const result = await request("/responses", {
      model: model.id,
      input: "What is the weather in Jakarta? Use the get_weather tool.",
      max_output_tokens: 256,
      tools: [
        {
          type: "function",
          name: "get_weather",
          description: "Get current weather",
          parameters: { type: "object", properties: { city: { type: "string" } }, required: ["city"] },
        },
      ],
      tool_choice: "auto",
    });
    console.log(`${model.id}\ttool-responses\t${result.status}\t${toolName(result.json) ?? "-"}\t${errorMessage(result.json)}`);
    return result.status === 200 && toolName(result.json) === "get_weather";
  }

  const result = await request("/messages", {
    model: model.id,
    max_tokens: 256,
    messages: [{ role: "user", content: "What is the weather in Jakarta? Use the get_weather tool." }],
    tools: [
      {
        name: "get_weather",
        description: "Get current weather",
        input_schema: { type: "object", properties: { city: { type: "string" } }, required: ["city"] },
      },
    ],
  });
  console.log(`${model.id}\ttool-messages\t${result.status}\t${toolName(result.json) ?? "-"}\t${errorMessage(result.json)}`);
  return result.status === 200 && toolName(result.json) === "get_weather";
}

async function testForcedResponses(model: CommandCodeModel): Promise<boolean> {
  const effort = highestEffort(model);
  const result = await request("/responses", {
    model: model.id,
    input: PROMPT,
    max_output_tokens: 512,
    reasoning: { effort: effort === "off" ? "none" : effort },
  });
  console.log(
    `${model.id}\tresponses-forced\t${effort}\t${result.status}\t${reasoningTokens(result.json) ?? "-"}\t${errorMessage(result.json)}`,
  );
  return result.status === 200;
}

const catalog = await loadCatalog({
  apiKey: API_KEY,
  store: new FileCatalogStore(),
  allowNetwork: true,
  force: true,
});

const visible = catalog.models.filter((model) => !model.hidden);
const counts = visible.reduce<Record<string, number>>((acc, model) => {
  acc[model.protocol] = (acc[model.protocol] ?? 0) + 1;
  return acc;
}, {});

console.log(
  `catalog=${catalog.catalogVersion} visible=${visible.length} messages=${counts["anthropic-messages"] ?? 0} chat=${counts["openai-chat"] ?? 0} responses=${counts["openai-responses"] ?? 0}`,
);
console.log("model\tprotocol\teffort\tstatus\treasoning_tokens\terror");

function candidates(protocol: CommandCodeModel["protocol"]): CommandCodeModel[] {
  return visible
    .filter((model) => model.protocol === protocol && model.efforts.length > 0)
    .sort((a, b) => planRank(a) - planRank(b) || a.id.localeCompare(b.id));
}

for (const protocol of ["anthropic-messages", "openai-chat"] as const) {
  let verified = 0;
  for (const model of candidates(protocol)) {
    if (verified >= 2) break;
    if (await testReasoning(model)) verified += 1;
  }
  if (verified === 0) console.log(`# no accessible ${protocol} reasoning sample`);
}

const chatSample = candidates("openai-chat")[0];
const messageSample = candidates("anthropic-messages")[0];

if (chatSample) {
  await testForcedResponses(chatSample);
  await testTool(chatSample);
}
if (messageSample) {
  await testTool(messageSample);
}
