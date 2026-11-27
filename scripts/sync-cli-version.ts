#!/usr/bin/env node
// The billing endpoints refuse stale CLI versions, so this is meant to run in the
// daily workflow: it keeps `packages/provider/src/cliVersion.ts` on the version
// npm actually publishes, and `--check` turns that into a failing gate.
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import process from "node:process";

const REGISTRY = "https://registry.npmjs.org/command-code/latest";
const TARGET = join("packages", "provider", "src", "cliVersion.ts");
const SEMVER = /^\d+\.\d+\.\d+$/;
const ANCHOR = /COMMAND_CODE_CLI_VERSION = "[^"]*"/;

async function npmVersion(): Promise<string> {
	const response = await fetch(REGISTRY, { headers: { Accept: "application/json" } });
	if (!response.ok) throw new Error(`npm registry returned HTTP ${response.status}`);
	const body = (await response.json()) as { version?: unknown };
	const version = typeof body.version === "string" ? body.version.trim() : "";
	if (!SEMVER.test(version)) throw new Error(`npm registry returned a non-semver version: ${JSON.stringify(body.version)}`);
	return version;
}

function currentVersion(source: string): string {
	const literal = ANCHOR.exec(source)?.[0];
	const version = literal === undefined ? undefined : literal.slice(literal.indexOf('"') + 1, -1);
	if (version === undefined || !SEMVER.test(version)) throw new Error(`${TARGET} has no usable COMMAND_CODE_CLI_VERSION`);
	return version;
}

async function main(): Promise<void> {
	const check = process.argv.includes("--check");
	const npm = await npmVersion();
	const source = readFileSync(TARGET, "utf8");
	const current = currentVersion(source);

	if (current === npm) {
		console.log(`cli version: ${npm} (current)`);
		return;
	}
	if (check) {
		console.error(`cli version: ${npm} on npm, ${current} in ${TARGET} (stale; run node scripts/sync-cli-version.ts)`);
		process.exit(1);
	}
	writeFileSync(TARGET, source.replace(ANCHOR, `COMMAND_CODE_CLI_VERSION = "${npm}"`));
	console.log(`cli version: ${current} -> ${npm}`);
}

main().catch((error: unknown) => {
	console.error(`cli version: ${error instanceof Error ? error.message : String(error)}`);
	process.exit(2);
});
