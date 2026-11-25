/**
 * Brand casing is not derivable from a slug, so it is curated. A provider's own
 * brand map wins over this table; both are policy, not vendor data.
 */
export const DEFAULT_BRANDS: Readonly<Record<string, string>> = {
	deepseek: "DeepSeek",
	gemini: "Gemini",
	glm: "GLM",
	gpt: "GPT",
	hy: "HY",
	kimi: "Kimi",
	llama: "Llama",
	mimo: "MiMo",
	minimax: "MiniMax",
	mistral: "Mistral",
	oss: "OSS",
	qwen: "Qwen",
	step: "Step",
	swe: "SWE",
};

/**
 * A colon suffix is not decoration. OpenRouter splits it two ways
 * (model-variants/overview):
 *
 * - a **catalog** variant is its own entry, with its own price, limits and
 *   endpoints. `vendor/model:free` is a different model from `vendor/model`, so
 *   the tag belongs in the label: dropping it would promise the paid entry's
 *   limits for a free, rate-capped one.
 * - a **routing** variant only reorders providers at request time. The base
 *   entry describes the model, so the tag never belongs in a label.
 *
 * Anything else stays literal: an unrecognised tag is shown rather than
 * swallowed, because a wrong label is cheaper to notice than a missing one.
 */
const CATALOG_VARIANTS: Readonly<Record<string, string>> = {
	free: "free",
	batch: "batch",
	thinking: "thinking",
	extended: "extended",
};

const ROUTING_VARIANTS: ReadonlySet<string> = new Set(["nitro", "floor", "exacto", "online"]);

export interface NamingOptions {
	/**
	 * Extra brands, merged **over** `DEFAULT_BRANDS`. A pack that adds one brand
	 * must not lose the shared table: `brands: { hy: "HY" }` once turned every
	 * DeepSeek, GLM and GPT label into `Deepseek`, `Glm`, `Gpt`.
	 */
	brands?: Readonly<Record<string, string>>;
	owners?: Readonly<Record<string, string>>;
	/** Full-id overrides for labels a slug alone cannot render. */
	names?: Readonly<Record<string, string>>;
}

function prettifyToken(token: string, brands: Readonly<Record<string, string>>): string {
	const brand = brands[token.toLowerCase()];
	if (brand !== undefined) return brand;
	// Version tokens carry their own casing: v4, 5.2.
	if (/^v?\d/i.test(token)) return token.toUpperCase();
	const head = token.slice(0, 1);
	return token.length === 0 ? token : head.toUpperCase() + token.slice(1);
}

interface VariantSplit {
	/** The id with its `:tag` suffixes removed. */
	base: string;
	/** Qualifiers to keep, in the order the vendor wrote them. */
	qualifiers: string[];
}

function splitVariants(id: string): VariantSplit {
	const colon = id.indexOf(":");
	if (colon === -1) return { base: id, qualifiers: [] };
	const qualifiers: string[] = [];
	for (const raw of id.slice(colon + 1).split(":")) {
		const tag = raw.trim();
		if (tag.length === 0) continue;
		const key = tag.toLowerCase();
		if (ROUTING_VARIANTS.has(key)) continue;
		// Catalog tags render as lower-case words: they name a tier, not a brand.
		qualifiers.push(CATALOG_VARIANTS[key] ?? tag);
	}
	return { base: id.slice(0, colon), qualifiers };
}

/**
 * Renders a catalog id for pickers: `vendor/kimi-k3` becomes `Kimi K3 (Vendor)`.
 * Empty tokens from repeated separators are dropped so a label can never
 * collapse into whitespace; a partial id degrades to the raw id.
 *
 * Everything after the model slug is a qualifier, so one parenthesised list
 * carries both: `vendor/flint:free` becomes `Flint (Vendor, free)`.
 */
export function displayName(id: string, options: NamingOptions = {}): string {
	const override = options.names?.[id];
	if (override !== undefined && override.trim().length > 0) return override.trim();

	const { base, qualifiers } = splitVariants(id);
	const slash = base.indexOf("/");
	const owner = slash === -1 ? "" : base.slice(0, slash).trim();
	const slug = (slash === -1 ? base : base.slice(slash + 1)).trim();
	if (slug.length === 0) return id;

	const brands = { ...DEFAULT_BRANDS, ...options.brands };
	const tokens = slug.split(/[-_]+/).filter((token) => token.length > 0);
	if (tokens.length === 0) return id;
	const pretty = tokens.map((token) => prettifyToken(token, brands)).join(" ");
	if (pretty.length === 0) return id;
	const parts = owner.length === 0 ? qualifiers : [options.owners?.[owner] ?? owner, ...qualifiers];
	if (parts.length === 0) return pretty;
	return `${pretty} (${parts.join(", ")})`;
}
