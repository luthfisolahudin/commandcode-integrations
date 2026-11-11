#!/usr/bin/env node
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";

import { formatViolation, scanSource, type BoundaryViolation, type Layer } from "../lib/boundaries.ts";

const ROOT = process.cwd();
const SCAN_DIRS = ["packages", "adapters", "examples"];

function layerForPath(relativePath: string): Layer | undefined {
	const normalised = relativePath.split(sep).join("/");
	if (normalised.startsWith("packages/contract/")) return "contract";
	if (normalised.startsWith("packages/catalog/")) return "catalog";
	if (normalised.startsWith("packages/provider/")) return "provider";
	if (normalised.startsWith("packages/cli/")) return "cli";
	if (normalised.startsWith("packages/conformance/")) return "conformance";
	if (normalised.startsWith("adapters/")) return "adapter";
	if (normalised.startsWith("examples/")) return "example";
	return undefined;
}

function walk(directory: string, files: string[] = []): string[] {
	let entries;
	try {
		entries = readdirSync(directory, { withFileTypes: true });
	} catch {
		return files;
	}
	for (const entry of entries) {
		if (entry.name === "node_modules" || entry.name === ".git" || entry.name === "dist") continue;
		const path = join(directory, entry.name);
		if (entry.isDirectory()) walk(path, files);
		else if (entry.isFile() && entry.name.endsWith(".ts")) files.push(path);
	}
	return files;
}

export function scanRepository(root: string): { violations: BoundaryViolation[]; files: number } {
	const violations: BoundaryViolation[] = [];
	let count = 0;
	for (const directory of SCAN_DIRS) {
		for (const file of walk(join(root, directory))) {
			const relativePath = relative(root, file);
			const layer = layerForPath(relativePath);
			if (layer === undefined) continue;
			count += 1;
			violations.push(...scanSource(relativePath, readFileSync(file, "utf8"), layer));
		}
	}
	return { violations, files: count };
}

const { violations, files } = scanRepository(ROOT);
if (violations.length > 0) {
	console.error(`boundaries: ${violations.length} forbidden import(s) across ${files} file(s)`);
	for (const violation of violations) console.error(`  ${formatViolation(violation)}`);
	console.error("Fix the import, or move the code to the package whose layer owns it.");
	process.exit(1);
}
console.log(`boundaries: ${files} file(s) respect the import matrix`);
