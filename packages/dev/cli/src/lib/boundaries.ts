import type { NormalizedModel, Pack } from "@luthfisolahudin/ai-integrations-contract";

/** Layer of a workspace package id, or `undefined` for an external dependency. */
export type Layer =
	| "contract"
	| "catalog"
	| "provider"
	| "factory"
	| "adapter"
	| "example"
	| "cli"
	| "conformance";

/**
 * Workspace scope. Every package in this repo is `@<scope>/<project>-integrations-<role>`.
 */
const SCOPE = "@luthfisolahudin/";

/**
 * The head token names the owner project; the tail names the role.
 *
 * `ai-integrations-*` is the upstream runtime, so a `pi`/`opencode` tail there is
 * the reusable factory. Any other head (`<vendor>-integrations-*`) with the same
 * tail is that checkout's host wiring.
 */
const ENGINE_HEAD = "ai-integrations-";

/** Layers keyed by role, for roles whose layer does not depend on the head. */
const SUFFIX_LAYER: Readonly<Record<string, Layer>> = {
	contract: "contract",
	catalog: "catalog",
	provider: "provider",
	cli: "cli",
	conformance: "conformance",
};

/** Host roles: the head decides whether the package is a factory or wiring. */
const HOST_ROLES = ["pi", "opencode"] as const;

/** Example packs carry a `tier-a`/`tier-b`/`tier-c` suffix. */
const EXAMPLE_PREFIX = "tier-";

/** Forbidden import directions. Absence means "allowed". */
export const FORBIDDEN: Readonly<Record<Layer, readonly Layer[]>> = {
	contract: ["catalog", "provider", "factory", "adapter", "example", "cli", "conformance"],
	catalog: ["provider", "factory", "adapter", "example", "cli", "conformance"],
	provider: ["catalog", "factory", "adapter", "example", "cli", "conformance"],
	factory: ["provider", "factory", "adapter", "example", "cli", "conformance"],
	adapter: ["adapter", "example", "cli", "conformance"],
	example: ["catalog", "provider", "factory", "adapter", "example", "cli", "conformance"],
	cli: ["factory", "adapter", "example", "conformance"],
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

/** Strips the scope and returns the package segment of a specifier. */
function packageNameOf(specifier: string): string | undefined {
	const unscoped = specifier.startsWith(SCOPE) ? specifier.slice(SCOPE.length) : specifier;
	const packageName = unscoped.split("/")[0];
	return packageName === undefined || packageName.length === 0 ? undefined : packageName;
}

/**
 * Resolves the role a package name ends with. Accepts the scoped form
 * (`@scope/<project>-integrations-contract`) and the bare form (`contract`).
 */
function roleOf(packageName: string): string | undefined {
	if (!packageName.includes("-")) return packageName;
	if (packageName.includes(`-${EXAMPLE_PREFIX}`)) return EXAMPLE_PREFIX;
	const roles = [...Object.keys(SUFFIX_LAYER), ...HOST_ROLES];
	let best: string | undefined;
	for (const role of roles) {
		if (!packageName.endsWith(`-${role}`)) continue;
		if (best === undefined || role.length > best.length) best = role;
	}
	return best;
}

export function layerOfSpecifier(specifier: string): { layer: Layer; packageId: string } | undefined {
	const packageName = packageNameOf(specifier);
	if (packageName === undefined) return undefined;
	const role = roleOf(packageName);
	if (role === undefined) return undefined;

	let layer: Layer | undefined;
	if (role === EXAMPLE_PREFIX) {
		layer = "example";
	} else if ((HOST_ROLES as readonly string[]).includes(role)) {
		layer = packageName.startsWith(ENGINE_HEAD) ? "factory" : "adapter";
	} else {
		layer = SUFFIX_LAYER[role];
	}
	return layer === undefined ? undefined : { layer, packageId: packageName };
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
