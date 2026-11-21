import type { NormalizedModel, Pack } from "../../../../engine/contract/index.ts";

/** Layer of a workspace package id, or `undefined` for an external dependency. */
export type Layer = "contract" | "catalog" | "provider" | "adapter" | "example" | "cli" | "conformance";

/**
 * Workspace scope. Every package in this repo is `@<scope>/<repo>-<suffix>`.
 */
const SCOPE = "@luthfisolahudin/";

/**
 * The suffix after `<repo>-` decides the layer.
 *
 * Deriving the layer instead of listing package ids is what keeps this file
 * honest across checkouts: a downstream repo deletes `examples/`, so a hardcoded
 * `tier-b`/`tier-c` entry would describe a package that no longer exists, and a
 * package added later would silently skip the check.
 */
const SUFFIX_LAYER: Readonly<Record<string, Layer>> = {
	contract: "contract",
	catalog: "catalog",
	provider: "provider",
	pi: "adapter",
	opencode: "adapter",
	cli: "cli",
	conformance: "conformance",
};

/** Example packs carry a `tier-a`/`tier-b`/`tier-c` suffix. */
const EXAMPLE_PREFIX = "tier-";

/** Forbidden import directions. Absence means "allowed". */
export const FORBIDDEN: Readonly<Record<Layer, readonly Layer[]>> = {
	contract: ["catalog", "provider", "adapter", "example", "cli", "conformance"],
	catalog: ["provider", "adapter", "example", "cli", "conformance"],
	provider: ["catalog", "adapter", "example", "cli", "conformance"],
	adapter: ["adapter", "example", "cli", "conformance"],
	example: ["catalog", "provider", "adapter", "example", "cli", "conformance"],
	cli: ["adapter", "example", "conformance"],
	conformance: [],
};

export interface BoundaryViolation {
	file: string;
	line: number;
	specifier: string;
	from: Layer;
	to: Layer;
}

const SPECIFIER = /(?:\bfrom\s*|\bimport\s*\(\s*)["']([^"']+)["']/g;

/**
 * Splits a workspace specifier into the suffix that names its layer. Accepts both
 * the scoped form (`@scope/<repo>-catalog/model`) and the bare form (`catalog`)
 * that the engine's copy-in rewrite produces.
 */
function suffixOf(specifier: string): string | undefined {
	const unscoped = specifier.startsWith(SCOPE) ? specifier.slice(SCOPE.length) : specifier;
	const packageName = unscoped.split("/")[0];
	if (packageName === undefined || packageName.length === 0) return undefined;

	// Bare form: the package segment is the suffix.
	if (!packageName.includes("-")) return packageName;

	// Scoped form `<repo>-<suffix>`. Example packs are `<repo>-tier-<x>`, so they
	// are matched by segment rather than by a fixed suffix.
	if (packageName.includes(`-${EXAMPLE_PREFIX}`)) return EXAMPLE_PREFIX;

	const known = Object.keys(SUFFIX_LAYER);
	let best: string | undefined;
	for (const suffix of known) {
		if (!packageName.endsWith(`-${suffix}`)) continue;
		if (best === undefined || suffix.length > best.length) best = suffix;
	}
	return best;
}

export function layerOfSpecifier(specifier: string): { layer: Layer; packageId: string } | undefined {
	const suffix = suffixOf(specifier);
	if (suffix === undefined) return undefined;
	const layer = SUFFIX_LAYER[suffix] ?? (suffix.startsWith(EXAMPLE_PREFIX) ? "example" : undefined);
	if (layer === undefined) return undefined;
	const unscoped = specifier.startsWith(SCOPE) ? specifier.slice(SCOPE.length) : specifier;
	const packageId = unscoped.split("/")[0];
	return packageId === undefined ? undefined : { layer, packageId };
}

/** Pure check, so tests and the CLI share one definition of the rules. */
export function checkImport(input: {
	file: string;
	line: number;
	specifier: string;
	from: Layer;
}): BoundaryViolation | undefined {
	const target = layerOfSpecifier(input.specifier);
	if (target === undefined) return undefined;
	if (!FORBIDDEN[input.from].includes(target.layer)) return undefined;
	return { file: input.file, line: input.line, specifier: input.specifier, from: input.from, to: target.layer };
}

export function scanSource(file: string, source: string, from: Layer): BoundaryViolation[] {
	const violations: BoundaryViolation[] = [];
	const lines = source.split("\n");
	for (const [index, text] of lines.entries()) {
		SPECIFIER.lastIndex = 0;
		let match: RegExpExecArray | null;
		while ((match = SPECIFIER.exec(text)) !== null) {
			const specifier = match[1];
			if (specifier === undefined) continue;
			const violation = checkImport({ file, line: index + 1, specifier, from });
			if (violation !== undefined) violations.push(violation);
		}
	}
	return violations;
}

/** Formats a violation the way a developer needs to read it. */
export function formatViolation(violation: BoundaryViolation): string {
	return `${violation.file}:${violation.line} ${violation.from} may not import ${violation.to} (${violation.specifier})`;
}

export type { NormalizedModel, Pack };
