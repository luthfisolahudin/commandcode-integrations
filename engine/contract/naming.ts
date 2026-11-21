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
};

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

/**
 * Renders a catalog id for pickers: `vendor/kimi-k3` becomes `Kimi K3 (Vendor)`.
 * Empty tokens from repeated separators are dropped so a label can never
 * collapse into whitespace; a partial id degrades to the raw id.
 */
export function displayName(id: string, options: NamingOptions = {}): string {
	const override = options.names?.[id];
	if (override !== undefined && override.trim().length > 0) return override.trim();

	const slash = id.indexOf("/");
	const owner = slash === -1 ? "" : id.slice(0, slash).trim();
	const slug = (slash === -1 ? id : id.slice(slash + 1)).trim();
	if (slug.length === 0) return id;

	const brands = { ...DEFAULT_BRANDS, ...options.brands };
	const tokens = slug.split(/[-_]+/).filter((token) => token.length > 0);
	if (tokens.length === 0) return id;
	const pretty = tokens.map((token) => prettifyToken(token, brands)).join(" ");
	if (pretty.length === 0) return id;
	if (owner.length === 0) return pretty;
	const ownerLabel = options.owners?.[owner] ?? owner;
	return `${pretty} (${ownerLabel})`;
}
