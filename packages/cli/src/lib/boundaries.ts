import type { NormalizedModel, Pack } from "@luthfisolahudin/commandcode-integrations-contract";

/** Layer of a workspace package id, or `undefined` for an external dependency. */
export type Layer = "contract" | "catalog" | "provider" | "adapter" | "example" | "cli" | "conformance";

export const PACKAGE_LAYER: Readonly<Record<string, Layer>> = {
	"@luthfisolahudin/commandcode-integrations-contract": "contract",
	"@luthfisolahudin/commandcode-integrations-catalog": "catalog",
	"@luthfisolahudin/commandcode-integrations-provider": "provider",
	"@luthfisolahudin/commandcode-integrations-pi": "adapter",
	"@luthfisolahudin/commandcode-integrations-opencode": "adapter",
	"@luthfisolahudin/commandcode-integrations-cli": "cli",
	"@luthfisolahudin/commandcode-integrations-conformance": "conformance",
	"@luthfisolahudin/commandcode-integrations-tier-b": "example",
	"@luthfisolahudin/commandcode-integrations-tier-c": "example",
};

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

export function layerOfSpecifier(specifier: string): { layer: Layer; packageId: string } | undefined {
	for (const [packageId, layer] of Object.entries(PACKAGE_LAYER)) {
		if (specifier === packageId || specifier.startsWith(`${packageId}/`)) return { layer, packageId };
	}
	return undefined;
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
