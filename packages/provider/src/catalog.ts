/**
 * CommandCode's catalog is two endpoints merged by id.
 *
 * - `GET /models?view=client` — the client catalog: display label, context,
 *   output cap, modalities, `reasoningEfforts`, pricing, plan, visibility. It is
 *   versioned (`schemaVersion`, `catalogVersion`, `refreshAfterSeconds`).
 * - `GET /models` — the public list: `supported_endpoints`, which is the only
 *   source of wire-protocol truth.
 *
 * Client fields win for facts; the public list wins for endpoints. A model present
 * only in the public list is still usable, just without declared efforts or prices.
 */

/** Engine wire apis. */
export type CommandCodeApi = "openai-completions" | "anthropic-messages" | "openai-responses";

export interface ClientPricing {
	inputCost?: number;
	outputCost?: number;
	cacheReadCost?: number;
	cacheWriteCost?: number;
	contextTiers?: Array<{
		maxContext?: number;
		rates?: { inputCost?: number; outputCost?: number; cacheReadCost?: number; cacheWriteCost?: number };
	}>;
}

export interface ClientModel {
	id: string;
	aliases?: string[];
	display?: { label?: string; group?: string };
	context_length?: number;
	maxOutputTokens?: number | null;
	inputModalities?: string[] | null;
	reasoningEfforts?: string[] | null;
	pricing?: ClientPricing;
	minimumPlan?: string | null;
	hidden?: boolean;
	zdr?: boolean;
}

export interface ClientCatalog {
	schemaVersion: number;
	catalogVersion: string;
	refreshAfterSeconds?: number;
	data: ClientModel[];
}

export interface PublicModel {
	id: string;
	name?: string;
	context_length?: number;
	/** The public list calls it `supported_endpoints`; the old fixture said `endpoints`. */
	supported_endpoints?: string[];
	endpoints?: string[];
}

/** One model, in the shape the pack's field aliases read. */
export interface CommandCodeRecord {
	id: string;
	name: string;
	context_length: number;
	maxOutputTokens: number | null;
	inputModalities: ("text" | "image")[];
	reasoningEfforts: string[];
	supported_endpoints: string[];
	protocol: CommandCodeApi;
	protocolReason: string;
	hidden: boolean;
	minimumPlan: string | null;
	/**
	 * Zero-data-retention capability as the client catalog declares it. Absent for a
	 * public-only model, which is `unknown`, not `false`.
	 * See `docs/EVIDENCE.md` for the wire check behind this field.
	 */
	zdr?: boolean;
	pricing?: Partial<Record<"input" | "output" | "cacheRead" | "cacheWrite", number>>;
	[key: string]: unknown;
}

const EFFORTS = new Set(["off", "low", "medium", "high", "xhigh", "max"]);

function endpointsOf(model: PublicModel): string[] {
	return model.supported_endpoints ?? model.endpoints ?? [];
}

export function isClaudeModel(id: string, group?: string): boolean {
	return group?.toLowerCase() === "anthropic" || /^claude(?:[-.]|$)/i.test(id);
}

/**
 * Chat-first routing.
 *
 * Claude goes to Anthropic Messages because that is how its thinking and effort
 * settings are expressed. Everything else prefers Chat Completions, which is what
 * this integration can verify; Responses is only chosen when a model is the one
 * route, and an unknown model is marked unverified rather than dropped.
 */
export function resolveProtocol(input: { id: string; group?: string; endpoints: readonly string[] }): {
	protocol?: CommandCodeApi;
	reason: string;
} {
	const endpoints = new Set(input.endpoints);
	if (endpoints.has("/messages") && isClaudeModel(input.id, input.group)) {
		return { protocol: "anthropic-messages", reason: "anthropic-model" };
	}
	if (endpoints.has("/chat/completions")) return { protocol: "openai-completions", reason: "chat-supported" };
	if (endpoints.has("/messages")) {
		return { protocol: "anthropic-messages", reason: "messages-supported" };
	}
	if (endpoints.has("/responses")) return { protocol: "openai-responses", reason: "chat-unsupported" };
	return endpoints.size === 0
		? { protocol: "openai-completions", reason: "default-unverified" }
		: { reason: "unsupported-endpoints" };
}

/**
 * Catalog rates are already **USD per 1M tokens**, which is the unit the hosts
 * want. Verified against the vendor's published table
 * (https://commandcode.ai/docs/plans/goat): `claude-sonnet-5-5` is listed at
 * `$2.00 / $10.00 / $0.10 / $2.50` and the client catalog reports exactly those
 * numbers. Multiplying here would inflate every price by 1,000,000 and still look
 * authoritative in a picker.
 */
function ratePerMillion(value: unknown): number | undefined {
	if (typeof value !== "number" || !Number.isFinite(value) || value < 0) return undefined;
	return value;
}

/**
 * Maps the catalog's rates onto the host model shape. Cache fields fall back to an
 * absent field when a rate is unpublished. A published zero stays zero.
 */
export function normalizePricing(pricing: ClientPricing | undefined): CommandCodeRecord["pricing"] {
	if (pricing === undefined) return undefined;
	const input = ratePerMillion(pricing.inputCost);
	const output = ratePerMillion(pricing.outputCost);
	const cacheRead = ratePerMillion(pricing.cacheReadCost);
	const cacheWrite = ratePerMillion(pricing.cacheWriteCost);
	if (input === undefined && output === undefined && cacheRead === undefined && cacheWrite === undefined) return undefined;
	return {
		...(input === undefined ? {} : { input }),
		...(output === undefined ? {} : { output }),
		...(cacheRead === undefined ? {} : { cacheRead }),
		...(cacheWrite === undefined ? {} : { cacheWrite }),
	};
}

function effortsOf(model: ClientModel): string[] {
	const declared = model.reasoningEfforts ?? [];
	return [...new Set(declared.filter((effort): effort is string => typeof effort === "string" && EFFORTS.has(effort)))];
}

function modalitiesOf(model: ClientModel): ("text" | "image")[] {
	const declared = model.inputModalities ?? ["text"];
	const input: ("text" | "image")[] = ["text"];
	if (declared.includes("image")) input.push("image");
	return input;
}

function toRecord(input: {
	id: string;
	name: string;
	group?: string;
	contextWindow: number;
	maxOutputTokens: number | null;
	modalities: ("text" | "image")[];
	efforts: string[];
	endpoints: string[];
	pricing?: CommandCodeRecord["pricing"];
	minimumPlan: string | null;
	hidden: boolean;
	zdr?: boolean;
}): CommandCodeRecord | undefined {
	const routed = resolveProtocol({ id: input.id, group: input.group, endpoints: input.endpoints });
	if (routed.protocol === undefined) return undefined;
	return {
		id: input.id,
		name: input.name,
		context_length: input.contextWindow,
		maxOutputTokens: input.maxOutputTokens,
		inputModalities: input.modalities,
		reasoningEfforts: input.efforts,
		supported_endpoints: input.endpoints,
		protocol: routed.protocol,
		protocolReason: routed.reason,
		hidden: input.hidden,
		minimumPlan: input.minimumPlan,
		...(input.zdr === undefined ? {} : { zdr: input.zdr }),
		...(input.pricing === undefined ? {} : { pricing: input.pricing }),
	};
}

/**
 * Merges both catalog views into one record list.
 *
 * Hidden models are dropped here rather than in the pack filter, because visibility
 * is a per-account property that the filter cannot express.
 */
export function mergeCatalog(client: ClientCatalog, publicModels: readonly PublicModel[]): CommandCodeRecord[] {
	const publicById = new Map(publicModels.map((model) => [model.id, model]));
	const seen = new Set<string>();
	const records: CommandCodeRecord[] = [];

	for (const model of client.data) {
		if (typeof model.id !== "string" || model.id.length === 0 || seen.has(model.id)) continue;
		seen.add(model.id);
		if (model.hidden === true) continue;
		const published = publicById.get(model.id);
		const endpoints = published === undefined ? [] : endpointsOf(published);
		const pricing = normalizePricing(model.pricing);
		const record = toRecord({
			id: model.id,
			name: model.display?.label ?? model.id,
			...(model.display?.group === undefined ? {} : { group: model.display.group }),
			contextWindow: model.context_length ?? published?.context_length ?? 128_000,
			maxOutputTokens: typeof model.maxOutputTokens === "number" ? model.maxOutputTokens : null,
			modalities: modalitiesOf(model),
			efforts: effortsOf(model),
			endpoints,
			...(pricing === undefined ? {} : { pricing }),
			minimumPlan: model.minimumPlan ?? null,
			hidden: false,
			...(typeof model.zdr === "boolean" ? { zdr: model.zdr } : {}),
		});
		if (record !== undefined) records.push(record);
	}

	for (const model of publicModels) {
		if (typeof model.id !== "string" || model.id.length === 0 || seen.has(model.id)) continue;
		seen.add(model.id);
		const record = toRecord({
			id: model.id,
			name: model.name ?? model.id,
			contextWindow: model.context_length ?? 128_000,
			maxOutputTokens: null,
			modalities: ["text"],
			efforts: [],
			endpoints: endpointsOf(model),
			minimumPlan: null,
			hidden: false,
		});
		if (record !== undefined) records.push(record);
	}

	return records;
}
