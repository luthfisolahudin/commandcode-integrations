import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

export interface ModelCost {
	/** USD per 1M tokens, as published. Zero when unknown. */
	input: number;
	output: number;
	cacheRead: number;
	cacheWrite: number;
}

export interface ModelMetadata {
	contextWindow?: number;
	maxOutput?: number;
	/** Provider-agnostic capability hint, used only when the pack is silent. */
	image?: boolean;
	reasoning?: boolean;
	tools?: boolean;
	/** USD per 1M tokens from models.dev, or absent when it publishes none. */
	cost?: Partial<ModelCost>;
	/** Effort levels the provider declares through `reasoning_options`. */
	efforts?: string[];
	/** Whether thinking can be turned off entirely. */
	toggle?: boolean;
	size: number;
}

export interface ModelIndex {
	readonly size: number;
	get(modelId: string): ModelMetadata | undefined;
}

function positive(value: unknown): number | undefined {
	return typeof value === "number" && Number.isFinite(value) && value > 0 ? Math.floor(value) : undefined;
}

function cost(value: unknown): number | undefined {
	return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : undefined;
}

/**
 * Normalises an id for cross-catalog comparison: lower-case, without a
 * `:free`-style tag or an `-YYYYMMDD` suffix, so `vendor/model` and `model`
 * land in one bucket.
 */
export function normalizeModelKey(id: string): string {
	return id
		.trim()
		.toLowerCase()
		.replace(/:[a-z0-9._-]+$/u, "")
		.replace(/-\d{8}$/u, "");
}

/** Last path segment of a normalised id. */
export function modelKey(id: string): string {
	const segments = normalizeModelKey(id).split("/");
	return segments[segments.length - 1] ?? "";
}

function majority<T>(values: readonly (T | undefined)[], tieTo?: T): T | undefined {
	const votes = new Map<T, number>();
	for (const value of values) {
		if (value === undefined) continue;
		votes.set(value, (votes.get(value) ?? 0) + 1);
	}
	let winner: T | undefined;
	for (const [value, count] of votes) {
		if (winner === undefined) {
			winner = value;
			continue;
		}
		const winnerCount = votes.get(winner) ?? 0;
		if (count > winnerCount) winner = value;
		else if (count === winnerCount && tieTo !== undefined) winner = value === tieTo ? value : winner;
	}
	return winner;
}

function majorityNumber(values: readonly (number | undefined)[]): number | undefined {
	const votes = new Map<number, number>();
	for (const value of values) {
		if (value === undefined) continue;
		votes.set(value, (votes.get(value) ?? 0) + 1);
	}
	let winner: number | undefined;
	for (const [value, count] of votes) {
		if (winner === undefined) {
			winner = value;
			continue;
		}
		const winnerCount = votes.get(winner) ?? 0;
		if (count > winnerCount || (count === winnerCount && value > winner)) winner = value;
	}
	return winner;
}

interface Sample {
	contextWindow?: number;
	maxOutput?: number;
	image?: boolean;
	reasoning?: boolean;
	tools?: boolean;
	efforts?: string[];
	toggle?: boolean;
	cost: Partial<ModelCost>;
}

function sampleOf(entry: unknown): Sample | undefined {
	if (typeof entry !== "object" || entry === null) return undefined;
	const model = entry as {
		limit?: { context?: unknown; output?: unknown };
		attachment?: unknown;
		reasoning?: unknown;
		tool_call?: unknown;
		modalities?: { input?: unknown };
		cost?: { input?: unknown; output?: unknown; cache_read?: unknown; cache_write?: unknown };
		reasoning_options?: unknown;
	};
	const modalities = Array.isArray(model.modalities?.input)
		? model.modalities.input.filter((item): item is string => typeof item === "string")
		: [];
	const sample: Sample = {
		cost: {
			...(cost(model.cost?.input) === undefined ? {} : { input: cost(model.cost?.input) }),
			...(cost(model.cost?.output) === undefined ? {} : { output: cost(model.cost?.output) }),
			...(cost(model.cost?.cache_read) === undefined ? {} : { cacheRead: cost(model.cost?.cache_read) }),
			...(cost(model.cost?.cache_write) === undefined ? {} : { cacheWrite: cost(model.cost?.cache_write) }),
		},
	};
	const contextWindow = positive(model.limit?.context);
	const maxOutput = positive(model.limit?.output);
	if (contextWindow !== undefined) sample.contextWindow = contextWindow;
	if (maxOutput !== undefined) sample.maxOutput = maxOutput;
	if (typeof model.attachment === "boolean") sample.image = model.attachment;
	else if (modalities.includes("image")) sample.image = true;
	if (typeof model.reasoning === "boolean") sample.reasoning = model.reasoning;
	if (typeof model.tool_call === "boolean") sample.tools = model.tool_call;
	const options = Array.isArray(model.reasoning_options) ? model.reasoning_options : [];
	for (const option of options) {
		if (typeof option !== "object" || option === null) continue;
		const entry = option as { type?: unknown; values?: unknown };
		if (entry.type === "toggle") sample.toggle = true;
		if (entry.type === "effort" && Array.isArray(entry.values)) {
			const values = entry.values.filter((value): value is string => typeof value === "string");
			if (values.length > 0) sample.efforts = values;
		}
	}
	// A record that says nothing useful must not create an index entry: an entry
	// means "models.dev knows this model", and silence is not knowledge.
	const facts = Object.keys(sample).filter((key) => key !== "cost");
	if (facts.length === 0 && Object.keys(sample.cost).length === 0) return undefined;
	return sample;
}

/**
 * Builds a metadata lookup from a models.dev-shaped document.
 *
 * Catalogs list the same model once per gateway and gateways clip windows, so
 * the **majority** value wins rather than the first one seen: an under-reported
 * window makes a host compact too early. Ties go to the larger window, because
 * limits are clipped far more often than they are inflated. Capability ties go
 * to `true` for the same reason: an under-reported capability silently drops
 * input, while an over-reported one fails loudly at the provider.
 *
 * Output caps are only counted for the chosen window, so a bigger window's cap
 * cannot leak through. Costs are a hint: the value is the most common published
 * price, not a promise about what this particular route bills.
 */
export function buildModelIndex(catalog: unknown): ModelIndex {
	const buckets = new Map<string, Sample[]>();
	if (typeof catalog !== "object" || catalog === null) {
		return { size: 0, get: () => undefined };
	}
	for (const provider of Object.values(catalog as Record<string, unknown>)) {
		const models = (provider as { models?: Record<string, unknown> } | null)?.models;
		if (typeof models !== "object" || models === null) continue;
		for (const [id, entry] of Object.entries(models)) {
			const sample = sampleOf(entry);
			if (sample === undefined) continue;
			const key = modelKey(id);
			if (key.length === 0) continue;
			const bucket = buckets.get(key);
			if (bucket === undefined) buckets.set(key, [sample]);
			else bucket.push(sample);
		}
	}

	const index = new Map<string, ModelMetadata>();
	for (const [key, samples] of buckets) {
		const contextWindow = majorityNumber(samples.map((sample) => sample.contextWindow));
		const maxOutput = majorityNumber(
			samples.filter((sample) => sample.contextWindow === contextWindow).map((sample) => sample.maxOutput),
		);
		const image = majority(samples.map((sample) => sample.image), true);
		const reasoning = majority(samples.map((sample) => sample.reasoning), true);
		const tools = majority(samples.map((sample) => sample.tools), true);
		const metadata: ModelMetadata = { size: samples.length };
		if (contextWindow !== undefined) metadata.contextWindow = contextWindow;
		if (maxOutput !== undefined) metadata.maxOutput = maxOutput;
		if (image !== undefined) metadata.image = image;
		if (reasoning !== undefined) metadata.reasoning = reasoning;
		if (tools !== undefined) metadata.tools = tools;
		const cost: Partial<ModelCost> = {};
		const input = majorityNumber(samples.map((sample) => sample.cost.input));
		const output = majorityNumber(samples.map((sample) => sample.cost.output));
		const cacheRead = majorityNumber(samples.map((sample) => sample.cost.cacheRead));
		const cacheWrite = majorityNumber(samples.map((sample) => sample.cost.cacheWrite));
		if (input !== undefined) cost.input = input;
		if (output !== undefined) cost.output = output;
		if (cacheRead !== undefined) cost.cacheRead = cacheRead;
		if (cacheWrite !== undefined) cost.cacheWrite = cacheWrite;
		if (Object.keys(cost).length > 0) metadata.cost = cost;
		const efforts = majority(samples.map((sample) => sample.efforts?.join(",")));
		if (efforts !== undefined) metadata.efforts = efforts.split(",");
		const toggle = majority(samples.map((sample) => sample.toggle), true);
		if (toggle !== undefined) metadata.toggle = toggle;
		index.set(key, metadata);
	}

	return {
		size: index.size,
		get(modelId: string): ModelMetadata | undefined {
			return index.get(modelKey(modelId));
		},
	};
}

export const MODELS_DEV_URL = "https://models.dev/api.json";
const DEFAULT_TTL_MS = 24 * 60 * 60 * 1_000;

export interface LoadModelIndexOptions {
	fetch?: typeof globalThis.fetch;
	signal?: AbortSignal;
	cachePath: string;
	now?: () => number;
	ttlMs?: number;
}

interface CachedCatalog {
	checkedAt: number;
	catalog: unknown;
}

function readCached(cachePath: string): CachedCatalog | undefined {
	try {
		const parsed = JSON.parse(readFileSync(cachePath, "utf8")) as Partial<CachedCatalog>;
		if (typeof parsed.checkedAt !== "number" || parsed.catalog === undefined) return undefined;
		return { checkedAt: parsed.checkedAt, catalog: parsed.catalog };
	} catch {
		return undefined;
	}
}

function writeCached(cachePath: string, cached: CachedCatalog): void {
	try {
		mkdirSync(dirname(cachePath), { recursive: true });
		writeFileSync(cachePath, JSON.stringify(cached));
	} catch {
		// A cache write must never fail discovery.
	}
}

/**
 * Builds the index from a previously downloaded models.dev snapshot, without
 * touching the network. Used on the offline/startup path so a host can fill
 * silence immediately after a clone.
 */
export function readCachedModelIndex(cachePath: string): ModelIndex | undefined {
	const cached = readCached(cachePath);
	if (cached === undefined) return undefined;
	const index = buildModelIndex(cached.catalog);
	return index.size > 0 ? index : undefined;
}

/**
 * Loads the models.dev metadata hint: fresh cache, then network, then stale
 * cache, then an empty index. Never throws: this is a hint, not a requirement.
 */
export async function loadModelIndex(options: LoadModelIndexOptions): Promise<ModelIndex> {
	const now = options.now ?? Date.now;
	const ttlMs = options.ttlMs ?? DEFAULT_TTL_MS;
	const cached = readCached(options.cachePath);

	if (cached !== undefined) {
		const fresh = now() >= cached.checkedAt && now() - cached.checkedAt < ttlMs;
		const index = buildModelIndex(cached.catalog);
		if (fresh && index.size > 0) return index;
		if (!fresh) {
			const fetched = await fetchIndex(options);
			if (fetched !== undefined) return fetched;
		}
		if (index.size > 0) return index;
	}

	const fetched = await fetchIndex(options);
	return fetched ?? { size: 0, get: () => undefined };
}

async function fetchIndex(options: LoadModelIndexOptions): Promise<ModelIndex | undefined> {
	const timeout = AbortSignal.timeout(10_000);
	const signal = options.signal === undefined ? timeout : AbortSignal.any([timeout, options.signal]);
	try {
		const response = await (options.fetch ?? globalThis.fetch)(MODELS_DEV_URL, { signal });
		if (!response.ok) return undefined;
		const catalog: unknown = await response.json();
		const index = buildModelIndex(catalog);
		if (index.size === 0) return undefined;
		writeCached(options.cachePath, { checkedAt: (options.now ?? Date.now)(), catalog });
		return index;
	} catch {
		return undefined;
	}
}
