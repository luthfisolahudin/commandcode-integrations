#!/usr/bin/env node
import { createHash } from "node:crypto";
import { readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { join, relative, sep } from "node:path";

const LOCK = "ai-integrations.lock.json";
const MARKERS = ["packages/runtime", "packages/dev"];

function walk(directory: string, out: string[] = []): string[] {
	for (const entry of readdirSync(directory, { withFileTypes: true })) {
		if (entry.name === "node_modules") continue;
		const path = join(directory, entry.name);
		if (entry.isDirectory()) walk(path, out);
		else if (entry.isFile()) out.push(path);
	}
	return out;
}

function manifest(): Record<string, string> {
	const files: Record<string, string> = {};
	for (const marker of MARKERS) {
		for (const path of walk(marker)) {
			const key = relative(process.cwd(), path).split(sep).join("/");
			files[key] = createHash("sha256").update(readFileSync(path)).digest("hex");
		}
	}
	return files;
}

const write = process.argv.includes("--write");
const tag = process.argv[process.argv.indexOf("--tag") + 1];

if (write) {
	const previous = (() => { try { return JSON.parse(readFileSync(LOCK, "utf8")); } catch { return {}; } })();
	writeFileSync(LOCK, JSON.stringify({ source: "luthfisolahudin/ai-integrations", tag: tag ?? previous.tag ?? "unpinned", files: manifest() }, null, 2) + "\n");
	console.log(`wrote ${LOCK}`);
} else {
	const lock = JSON.parse(readFileSync(LOCK, "utf8")) as { tag: string; files: Record<string, string> };
	const actual = manifest();
	const drift: string[] = [];
	for (const [path, hash] of Object.entries(lock.files)) {
		if (actual[path] === undefined) drift.push(`${path} (missing)`);
		else if (actual[path] !== hash) drift.push(path);
	}
	for (const path of Object.keys(actual)) if (lock.files[path] === undefined) drift.push(`${path} (not in lock)`);
	if (drift.length > 0) {
		console.error(`copied packages differ from ${LOCK} (tag ${lock.tag}):\\n  ${drift.slice(0, 10).join("\\n  ")}`);
		process.exit(1);
	}
	console.log(`upstream ${lock.tag}: ${Object.keys(lock.files).length} file(s) match the lock`);
}
