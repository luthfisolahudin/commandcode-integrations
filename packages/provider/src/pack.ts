import { PACK_SCHEMA_VERSION, definePack } from "@luthfisolahudin/commandcode-integrations-contract";

import { mergeCatalog, type ClientCatalog, type PublicModel } from "./catalog.ts";
import { curated } from "./curated.ts";
import { FALLBACK } from "./fallback.ts";

const BASE_URL = "https://api.commandcode.ai/provider/v1";
const USER_AGENT = "commandcode-integrations/0.1";
const SCHEMA_VERSION = 1;

async function fetchJson(url: string, headers: Record<string, string>, signal: AbortSignal): Promise<unknown> {
	const response = await fetch(url, { headers, signal });
	if (!response.ok) throw new Error(`${url} responded ${response.status}`);
	return response.json();
}

function publicList(payload: unknown): PublicModel[] {
	if (Array.isArray(payload)) return payload as PublicModel[];
	const body = payload as { data?: unknown; models?: unknown };
	if (Array.isArray(body?.data)) return body.data as PublicModel[];
	if (Array.isArray(body?.models)) return body.models as PublicModel[];
	return [];
}

/**
 * CommandCode publishes its catalog as two views, so discovery is a hook rather
 * than a field mapping. The client view is authoritative for facts; the public list
 * is authoritative for `supported_endpoints`, which decides the wire protocol.
 *
 * If the client view fails, the public list still yields usable models without
 * efforts or prices — the integration degrades, it does not invent.
 */
export const commandCodePack = definePack({
	schemaVersion: PACK_SCHEMA_VERSION,
	id: "commandcode",
	name: "Command Code",
	baseUrl: BASE_URL,
	api: "openai-completions",
	auth: {
		kind: "bearer",
		apiKeyEnv: "COMMANDCODE_API_KEY",
		// The CLI stores its own credential; fall back to it so a machine that is
		// logged in to CommandCode needs no extra setup.
		keyFiles: [
			{ path: "~/.pi/agent/commandcode/auth.json", keys: ["apiKey", "apiKeys"] },
			{ path: "~/.commandcode/auth.json", keys: ["apiKey"] },
		],
	},
	discovery: { path: "/models", timeoutMs: 10_000, userAgent: USER_AGENT },
	fields: {
		contextWindow: ["context_length"],
		maxOutput: ["maxOutputTokens"],
		inputModalities: ["inputModalities"],
		efforts: ["reasoningEfforts"],
		displayName: ["name"],
	},
	filter: { nonChatPattern: "(^|[-_/])(embed|embedding|rerank)([-_/]|$)", dropOffline: true },
	// CommandCode never names its thinking format, but both `/chat/completions` and
	// `/messages` take an effort value; see docs/EVIDENCE.md.
	defaultThinkingFormat: "openai",
	fallback: FALLBACK.map((id) => ({ id })),
	curated,
	defaults: { contextWindow: 128_000, maxOutput: 32_768 },
	hooks: {
		async discover(context) {
			const headers = { ...context.headers, "User-Agent": USER_AGENT };
			const [clientPayload, publicPayload] = await Promise.all([
				fetchJson(`${context.baseUrl}/models?view=client`, headers, context.signal).catch(() => undefined),
				fetchJson(`${context.baseUrl}/models`, headers, context.signal).catch(() => undefined),
			]);
			if (clientPayload === undefined && publicPayload === undefined) {
				throw new Error("both CommandCode catalog views failed");
			}

			let client: ClientCatalog | undefined;
			if (clientPayload !== undefined) {
				const body = clientPayload as Partial<ClientCatalog>;
				if (body.schemaVersion !== SCHEMA_VERSION) {
					throw new Error(`unsupported client catalog schema: ${body.schemaVersion}`);
				}
				if (typeof body.catalogVersion !== "string" || !Array.isArray(body.data)) {
					throw new Error("client catalog is missing catalogVersion or data");
				}
				client = { schemaVersion: body.schemaVersion, catalogVersion: body.catalogVersion, data: body.data };
			}

			const records = mergeCatalog(client ?? { schemaVersion: SCHEMA_VERSION, catalogVersion: "unknown", data: [] }, publicList(publicPayload));
			if (records.length === 0) throw new Error("CommandCode catalog produced no models");
			return records;
		},
		normalize(record) {
			const efforts = Array.isArray(record.reasoningEfforts) ? record.reasoningEfforts : [];
			const pricing = record.pricing as
				| { input: number; output: number; cacheRead: number; cacheWrite: number }
				| undefined;
			return {
				...(typeof record.protocol === "string" ? { api: record.protocol } : {}),
				reasoning: efforts.length > 0,
				thinkingCanDisable: efforts.includes("off"),
				...(pricing === undefined
					? {}
					: { cost: { input: pricing.input, output: pricing.output, cacheRead: pricing.cacheRead, cacheWrite: pricing.cacheWrite } }),
			};
		},
	},
	hosts: {
		pi: { compat: { maxTokensField: "max_tokens" } },
		opencode: { package: "@opencode/ai/providers/openai-compatible" },
	},
});
