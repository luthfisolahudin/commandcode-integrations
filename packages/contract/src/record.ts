/** Where one resolved fact came from. Rendered in `docs/PROVIDERS.md` and checked by CI. */
export type Source = "catalog" | "curated" | "models.dev" | "default" | "measured";

/** Availability as the provider reports it. `unknown` means the catalog does not say. */
export type Availability = "ok" | "offline" | "unknown";

export type Modality = "text" | "image" | "pdf" | "audio" | "video";
export type OutputModality = "text" | "image" | "audio";

/** One row of raw provider data, already parsed but not yet normalised. */
export type RawRecord = Record<string, unknown>;

/** Facts about a single model, before defaults and provenance are applied. */
export interface ModelFacts {
	id: string;
	name?: string;
	contextWindow?: number;
	maxOutput?: number;
	input?: Modality[];
	output?: OutputModality[];
	tools?: boolean;
	reasoning?: boolean;
	thinkingFormat?: string;
	thinkingCanDisable?: boolean;
	availability?: Availability;
	/** Wire api for this model when the provider mixes protocols. */
	api?: string;
	/** Effort levels the provider's own catalog declares. */
	efforts?: string[];
	/** Explicit USD per 1M override; beats the models.dev hint. */
	cost?: Partial<ModelCost>;
}

export interface ModelCost {
	/** USD per 1M tokens. Sourced from models.dev; zero when unknown. */
	input: number;
	output: number;
	cacheRead: number;
	cacheWrite: number;
}

export interface Provenance {
	/** Recorded per limit: a curated context with a defaulted output is still half a guess. */
	limits: { context: Source; maxOutput: Source };
	modalities: Source;
	reasoning: Source;
	pricing: Source;
	effort: Source;
}

export interface ThinkingFacts {
	/** Format as declared by the provider, before any host mapping. */
	format?: string;
	canDisable?: boolean;
	/** Only set when a probe recorded evidence. See `docs/THINKING.md`. */
	wireEffort?: string;
	/** Levels the provider (via models.dev) declares. A declaration, not a measurement. */
	efforts?: string[];
}

export interface NormalizedModel {
	providerId: string;
	id: string;
	name: string;
	contextWindow: number;
	maxOutput: number;
	input: Modality[];
	output: OutputModality[];
	tools?: boolean;
	reasoning: boolean;
	thinking: ThinkingFacts;
	/** Wire API for this model when the provider mixes routes. */
	api?: string;
	cost: ModelCost;
	availability: Availability;
	provenance: Provenance;
	/** Present when the record was dropped from pickers; never dropped silently. */
	excluded?: { reason: string };
}
