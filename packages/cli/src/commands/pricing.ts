#!/usr/bin/env node
import { copyFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

import { loadModelIndex, modelsDevCachePath } from "@luthfisolahudin/commandcode-integrations-catalog";

import {
	buildPricingFragment,
	comparePricing,
	detectIndent,
	mergePricing,
	t3SettingsPath,
} from "../lib/pricing.ts";
import { loadAll, loadLivePack } from "../lib/packs.ts";

/**
 * Emits or applies the T3 Code pricing block for this repo's providers.
 *
 * Default is a dry run that prints the JSON fragment. `--write` merges it into
 * T3 Code's settings, touching only keys that belong to this repo's provider
 * ids, and keeps a timestamped backup.
 */
const write = process.argv.includes("--write");
const check = process.argv.includes("--check");
const prune = process.argv.includes("--prune");
const live = process.argv.includes("--live");
const jsonOnly = process.argv.includes("--json");

const settingsPath = t3SettingsPath(process.env, homedir());
const modelsDev = await loadModelIndex({ cachePath: modelsDevCachePath() });

const loaded = [];
for (const entry of loadAll(process.cwd(), { modelsDev })) {
	if (live) {
		try {
			loaded.push(await loadLivePack(entry.pack, {}, modelsDev));
			continue;
		} catch (error) {
			console.error(`${entry.pack.id}: live discovery failed (${error instanceof Error ? error.message : String(error)})`);
		}
	}
	loaded.push(entry);
}

const packs = loaded.map((entry) => entry.pack);
const models = loaded.flatMap((entry) => entry.models);
const fragment = buildPricingFragment(models, packs);
const providerIds = packs.map((pack) => pack.id);

if (jsonOnly || (!write && !check)) {
	process.stdout.write(`${JSON.stringify(fragment, null, 2)}\n`);
	const priced = Object.keys(fragment.usagePriceOverrides).length;
	const aliased = Object.keys(fragment.usageModelAliases).length;
	console.error(
		`\n${priced} priced model(s), ${aliased} alias(es) for ${providerIds.join(", ")}. ` +
			`models.dev hint: ${modelsDev.size}. Settings path: ${settingsPath}`,
	);
	console.error("Re-run with --write to merge into T3 Code settings, or --check to compare.");
	process.exit(0);
}

if (!existsSync(settingsPath)) {
	console.error(`T3 Code settings not found at ${settingsPath}`);
	console.error("Set T3_SETTINGS_PATH if the app stores settings elsewhere.");
	process.exit(2);
}

const source = readFileSync(settingsPath, "utf8");
const settings = JSON.parse(source) as Record<string, unknown>;

if (check) {
	const drift = comparePricing(settings, fragment, providerIds);
	const problems = [...drift.missing, ...drift.different];
	if (problems.length === 0) {
		console.log(`pricing: T3 Code matches this repo (${Object.keys(fragment.usagePriceOverrides).length} priced model(s))`);
		if (drift.stale.length > 0) console.log(`note: ${drift.stale.length} stale entr(ies) for this provider; run --write --prune`);
		process.exit(0);
	}
	console.error(`pricing: ${problems.length} difference(s) against T3 Code`);
	for (const key of drift.missing) console.error(`  missing: ${key}`);
	for (const key of drift.different) console.error(`  different: ${key}`);
	if (drift.stale.length > 0) console.error(`  stale: ${drift.stale.join(", ")}`);
	process.exit(1);
}

const merged = mergePricing(settings, fragment, { providerIds, ...(prune ? { prune: true } : {}) });
const indent = detectIndent(source);
const backup = `${settingsPath}.bak-${new Date().toISOString().replace(/[:.]/g, "-")}`;
copyFileSync(settingsPath, backup);
writeFileSync(settingsPath, `${JSON.stringify(merged.settings, null, indent)}\n`);

console.log(`pricing: wrote ${settingsPath}`);
console.log(`  backup:  ${backup}`);
console.log(`  added:   ${merged.added.length}`);
console.log(`  updated: ${merged.updated.length}`);
if (merged.removed.length > 0) console.log(`  removed: ${merged.removed.length}`);
console.log(`  untouched entries owned by other providers: ${merged.untouched}`);
for (const key of merged.added.slice(0, 10)) console.log(`  + ${key}`);
for (const key of merged.updated.slice(0, 10)) console.log(`  ~ ${key}`);
