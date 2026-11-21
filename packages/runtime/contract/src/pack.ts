import type { ModelFacts, NormalizedModel, RawRecord } from "./record.ts";
import { PI_THINKING_FORMATS } from "./thinking.ts";

/** Bump when a pack needs new fields or renamed hooks. `provider-doctor` checks it. */
export const PACK_SCHEMA_VERSION = 1;

/**
 * Dotted-path aliases: where this provider puts each fact, most specific first.
 * A missing key means "this provider never declares it", which is different from
 * "declared empty" and is what keeps unknown facts unknown.
 */
export interface FieldAliases {
	contextWindow?: string[];
	maxOutput?: string[];
	vision?: string[];
	pdf?: string[];
	audioInput?: string[];
	videoInput?: string[];
	imageOutput?: string[];
	audioOutput?: string[];
	inputModalities?: string[];
	tools?: string[];
	reasoning?: string[];
	thinkingFormat?: string[];
	thinkingCanDisable?: string[];
	efforts?: string[];
	availability?: string[];
	displayName?: string[];
}

export interface DiscoverySpec {
	/** Path appended to `baseUrl`, usually `/models`. */
	path: string;
	/**
	 * `auto` accepts `{data:[]}`, `{models:[]}`, `[]`, or a single record, and
	 * rejects anything else. Providers with a bespoke envelope use `hooks.discover`.
	 */
	parser?: "auto";
	timeoutMs?: number;
	headers?: Record<string, string>;
	/** Send `If-None-Match` and accept a 304 when a snapshot exists. */
	etag?: boolean;
	userAgent?: string;
}

export interface FilterSpec {
	/** Always dropped, recorded with a reason. */
	excludeIds?: string[];
	/** Ids matching this regex are treated as non-chat (embeddings, rerankers). */
	nonChatPattern?: string;
	/** Drop models the provider reports as offline. Defaults to true. */
	dropOffline?: boolean;
}

export interface HookContext {
	baseUrl: string;
	apiKey?: string;
	headers: Record<string, string>;
	signal: AbortSignal;
}

/**
 * Escape hatches for endpoints the declarative path cannot express. A hook may
 * describe what it needs, but it never owns network or cache behaviour: those
 * stay in `catalog` so both hosts benefit.
 */
export interface PackHooks {
	/** Replace discovery entirely (multi-endpoint merge, catalogVersion, paging). */
	discover?: (context: HookContext) => Promise<RawRecord[]>;
	/** Facts the declarative aliases cannot express. Return `undefined` to drop. */
	normalize?: (record: RawRecord) => Partial<ModelFacts> | undefined;
	/** Per-model wire API when a provider mixes routes. */
	route?: (facts: ModelFacts) => string;
	/** Display name, grouping, ordering. Must not invent membership. */
	decorate?: (model: NormalizedModel) => NormalizedModel;
	/** Request-time parameters for a thinking level. */
	requestParams?: (input: { level: string; effort: string }) => Record<string, unknown>;
}

export interface HostHints {
	pi?: {
		compat?: Record<string, unknown>;
		smallModel?: string;
	};
	opencode?: {
		package?: string;
		smallModel?: string;
	};
}

export interface Pack {
	schemaVersion: number;
	id: string;
	name: string;
	baseUrl: string;
	/** Wire API for every model unless `hooks.route` says otherwise. */
	api?: string;
	auth?: {
		kind: "bearer" | "none";
		apiKeyEnv?: string;
		apiKey?: string;
		/**
		 * JSON files to read a key from when the environment has none, in order.
		 * Each file is read as `{ apiKey }` or `{ apiKeys: [first] }`.
		 */
		keyFiles?: { path: string; keys: ("apiKey" | "apiKeys")[] }[];
	};
	discovery: DiscoverySpec;
	fields?: FieldAliases;
	filter?: FilterSpec;
	/** Membership served before the first successful discovery. Keep it minimal. */
	fallback?: { id: string }[];
	defaults?: { contextWindow?: number; maxOutput?: number };
	/**
	 * Metadata lookup indirection: model id -> the id models.dev knows it by.
	 * Used when the provider names a model differently, or when its price and
	 * capabilities are published under another entry.
	 */
	aliases?: Record<string, string>;
	/**
	 * Measured equivalences for a format Pi does not name, e.g. mapping the
	 * router's `gemini-budget` onto `openai`. Only with evidence in the repo's
	 * effort matrix or evidence log.
	 */
	thinkingFormatOverrides?: Record<string, string>;
	/**
	 * Thinking format to assume when a model declares none. Only for providers whose
	 * route is known to take `reasoning_effort`, with evidence in the repo.
	 */
	defaultThinkingFormat?: string;
	/** Curated overrides keyed by model id. `cost` here beats models.dev. */
	curated?: Record<string, Partial<ModelFacts>>;
	brands?: Record<string, string>;
	owners?: Record<string, string>;
	names?: Record<string, string>;
	hooks?: PackHooks;
	hosts?: HostHints;
}

/** Validates at import time so a broken pack fails before it reaches a picker. */
export function definePack(pack: Pack): Pack {
	validatePack(pack);
	return pack;
}

/** @throws When a required field is missing or malformed. */
export function validatePack(pack: Pack): void {
	if (pack.schemaVersion !== PACK_SCHEMA_VERSION) {
		throw new Error(
			`pack "${pack.id}": schemaVersion ${pack.schemaVersion} does not match PACK_SCHEMA_VERSION ${PACK_SCHEMA_VERSION}`,
		);
	}
	if (!pack.id.trim()) throw new Error("pack: id is required");
	if (!pack.name.trim()) throw new Error(`pack "${pack.id}": name is required`);
	if (!/^https?:\/\//.test(pack.baseUrl)) {
		throw new Error(`pack "${pack.id}": baseUrl must be an http(s) URL`);
	}
	if (!pack.discovery.path.startsWith("/")) {
		throw new Error(`pack "${pack.id}": discovery.path must start with "/"`);
	}
	if (pack.discovery.timeoutMs !== undefined && pack.discovery.timeoutMs <= 0) {
		throw new Error(`pack "${pack.id}": discovery.timeoutMs must be positive`);
	}
	for (const [modelId, key] of Object.entries(pack.aliases ?? {})) {
		if (modelId.trim().length === 0 || key.trim().length === 0) {
			throw new Error(`pack "${pack.id}": aliases need a non-empty id and target`);
		}
	}
	for (const [modelId, facts] of Object.entries(pack.curated ?? {})) {
		if (facts.id !== undefined && facts.id !== modelId) {
			throw new Error(`pack "${pack.id}": curated key "${modelId}" disagrees with its id "${facts.id}"`);
		}
	}
	for (const file of pack.auth?.keyFiles ?? []) {
		if (file.path.trim().length === 0) throw new Error(`pack "${pack.id}": auth.keyFiles needs a path`);
		if (file.keys.length === 0) throw new Error(`pack "${pack.id}": auth.keyFiles needs at least one key field`);
	}
	if (pack.defaultThinkingFormat !== undefined && !PI_THINKING_FORMATS.has(pack.defaultThinkingFormat)) {
		throw new Error(`pack "${pack.id}": defaultThinkingFormat "${pack.defaultThinkingFormat}" is not a Pi format`);
	}
	for (const [declared, mapped] of Object.entries(pack.thinkingFormatOverrides ?? {})) {
		if (declared.trim().length === 0) {
			throw new Error(`pack "${pack.id}": thinkingFormatOverrides needs a declared format`);
		}
		if (!PI_THINKING_FORMATS.has(mapped)) {
			throw new Error(
				`pack "${pack.id}": thinkingFormatOverrides maps "${declared}" to "${mapped}", which is not a Pi format`,
			);
		}
	}
	if (pack.filter?.nonChatPattern !== undefined) {
		try {
			new RegExp(pack.filter.nonChatPattern);
		} catch {
			throw new Error(`pack "${pack.id}": filter.nonChatPattern is not a valid regex`);
		}
	}
}
