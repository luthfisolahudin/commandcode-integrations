/**
 * Live verification: one tiny request per wire protocol, using a model the catalog
 * actually routes there. Prints status, protocol and reasoning-token counts.
 *
 *   node packages/provider/verify-live.ts
 *
 * Reads the key exactly like the integration does, and never prints it.
 */
import { resolveApiKey } from "@luthfisolahudin/commandcode-integrations-catalog";

import { commandCodePack, mergeCatalog, type ClientCatalog, type PublicModel } from "./packages/provider/src/index.ts";

const base = commandCodePack.baseUrl.replace(/\/+$/, "");
const key = resolveApiKey(commandCodePack);
if (key === undefined) {
	console.error("No key. Set COMMANDCODE_API_KEY or log in to CommandCode first.");
	process.exit(2);
}
const headers = {
	Authorization: `Bearer ${key}`,
	"Content-Type": "application/json",
	"User-Agent": "commandcode-integrations/0.1",
	Accept: "application/json",
};
const signal = AbortSignal.timeout(30_000);

const [clientPayload, publicPayload] = await Promise.all([
	fetch(`${base}/models?view=client`, { headers, signal }).then((response) => response.json()),
	fetch(`${base}/models`, { headers, signal }).then((response) => response.json()),
]);
const client = clientPayload as ClientCatalog;
const publicModels = Array.isArray(publicPayload) ? (publicPayload as PublicModel[]) : [];
const records = mergeCatalog(client, publicModels);
const counts = new Map<string, number>();
for (const record of records) counts.set(record.protocol, (counts.get(record.protocol) ?? 0) + 1);
console.log(`catalog: ${records.length} models — ${[...counts].map(([protocol, count]) => `${count} ${protocol}`).join(", ")}`);

const prompt = "Reply with exactly: ok";
for (const protocol of ["openai-completions", "anthropic-messages", "openai-responses"] as const) {
	const model = records.find((record) => record.protocol === protocol);
	if (model === undefined) {
		console.log(`${protocol}: no model routes there`);
		continue;
	}
	const url =
		protocol === "openai-completions" ? `${base}/chat/completions` : protocol === "anthropic-messages" ? `${base}/messages` : `${base}/responses`;
	const body =
		protocol === "anthropic-messages"
			? { model: model.id, max_tokens: 32, messages: [{ role: "user", content: prompt }] }
			: protocol === "openai-completions"
				? { model: model.id, max_tokens: 32, messages: [{ role: "user", content: prompt }] }
				: { model: model.id, max_output_tokens: 32, input: prompt };

	try {
		const response = await fetch(url, { method: "POST", headers, body: JSON.stringify(body), signal });
		const text = await response.text();
		const parsed = text.length > 0 ? (JSON.parse(text) as { usage?: Record<string, unknown>; error?: unknown }) : {};
		const reasoning =
			(parsed.usage?.["reasoning_tokens"] as number | undefined) ??
			(parsed.usage?.["completion_tokens_details"] as { reasoning_tokens?: number } | undefined)?.reasoning_tokens ??
			0;
		console.log(`${protocol}: ${model.id} → ${response.status} (reasoning tokens: ${reasoning})`);
		if (response.status === 403) console.log("  plan gating, not a routing failure");
	} catch (error) {
		console.log(`${protocol}: ${model.id} → failed: ${error instanceof Error ? error.message : String(error)}`);
	}
}
