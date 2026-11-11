#!/usr/bin/env node
import { loadModelIndex, modelsDevCachePath, readCachedModelIndex } from "@luthfisolahudin/commandcode-integrations-catalog";
import {
	checkInvariants,
	declaredOnly,
	excluded,
	INVENTORY_HEADER,
	inventoryRows,
	loadAll,
	loadLivePack,
	unmeasured,
} from "../lib/packs.ts";

function table(header: readonly string[], rows: readonly (readonly string[])[]): string {
	const widths = header.map((cell, index) => Math.max(cell.length, ...rows.map((row) => (row[index] ?? "").length)));
	const line = (cells: readonly string[]) => cells.map((cell, index) => cell.padEnd(widths[index] ?? 0)).join("  ");
	return [line(header), widths.map((width) => "-".repeat(width)).join("  "), ...rows.map(line)].join("\n");
}

const live = process.argv.includes("--live");
const loaded = [];
const problems: string[] = [];

if (live) {
	const modelsDev = await loadModelIndex({ cachePath: modelsDevCachePath() });
	console.log(`models.dev hint: ${modelsDev.size} model(s) known`);
	for (const entry of loadAll(process.cwd())) {
		try {
			loaded.push(await loadLivePack(entry.pack, {}, modelsDev));
		} catch (error) {
			problems.push(`${entry.pack.id}: live discovery failed (${error instanceof Error ? error.message : String(error)})`);
			loaded.push(entry);
		}
	}
} else {
	// Cache only: an offline check must not wait on the network.
	const cached = readCachedModelIndex(modelsDevCachePath());
	loaded.push(...loadAll(process.cwd(), cached === undefined ? {} : { modelsDev: cached }));
}

for (const entry of loaded) {
	if (entry.fixture === undefined) problems.push(`${entry.pack.id}: no fixture captured, reporting the pinned fallback only`);
	console.log(`\n${entry.pack.id} (${entry.pack.name}) — source: ${entry.source}, ${entry.models.length} model(s)`);
	console.log(table(INVENTORY_HEADER, inventoryRows(entry.models)));

	const hidden = excluded(entry.models);
	if (hidden.length > 0) console.log(`  excluded: ${hidden.map((item) => `${item.id} (${item.reason})`).join(", ")}`);

	const declaredIds = declaredOnly(entry.models);
	if (declaredIds.length > 0) console.log(`  declared effort (models.dev, unprobed): ${declaredIds.length} model(s)`);
	const unmeasuredIds = unmeasured(entry.models);
	if (unmeasuredIds.length > 0) {
		console.log(`  reasoning models with no effort information: ${unmeasuredIds.join(", ")}`);
	}
}

const invariantFailures = checkInvariants(loaded);
if (invariantFailures.length > 0) {
	console.error("\ncatalog violates curated ground truth:");
	for (const failure of invariantFailures) {
		console.error(`  ✖ ${failure.model} ${failure.key}: expected ${String(failure.expected)}, got ${String(failure.actual)}`);
	}
	console.error("Fix the provider mapping (or the invariant if reality changed), then re-run.");
}

const unmeasuredCount = loaded.flatMap((entry) => unmeasured(entry.models)).length;
if (unmeasuredCount > 0) {
	console.log(
		`\nnote: ${unmeasuredCount} reasoning model(s) have no effort information at all. They stay visible without an effort menu. See docs/THINKING.md.`,
	);
}

if (problems.length > 0) for (const problem of problems) console.error(`warning: ${problem}`);

process.exitCode = invariantFailures.length > 0 ? 1 : 0;
