import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { checkAgentFiles, checkProviderShape, checkSkills } from "@luthfisolahudin/commandcode-integrations-cli";
import { PACK_SCHEMA_VERSION, validatePack } from "@luthfisolahudin/commandcode-integrations-contract";
import { packs } from "@luthfisolahudin/commandcode-integrations-provider";

const ROOT = join(import.meta.dirname, "../../..");

test("the repo's packs validate and match the current schema", () => {
	for (const pack of packs) {
		assert.doesNotThrow(() => validatePack(pack), pack.id);
		assert.equal(pack.schemaVersion, PACK_SCHEMA_VERSION, pack.id);
		assert.match(pack.baseUrl, /^https?:\/\//, pack.id);
		// A local router is a legitimate provider; anything off the loopback must be TLS.
		if (pack.baseUrl.startsWith("http://")) {
			assert.match(
				pack.baseUrl,
				/^http:\/\/(127\.0\.0\.1|localhost|\[::1\])(:|\/)/,
				`${pack.id} must use https unless it is loopback`,
			);
		}
	}
});

test("pack ids are unique", () => {
	const ids = packs.map((pack) => pack.id);
	assert.equal(new Set(ids).size, ids.length);
});

test("agent files and the symlink pair are intact", () => {
	assert.deepEqual(checkAgentFiles(ROOT).failures, []);
});

test("every skill parses and references real tasks and paths", () => {
	assert.deepEqual(checkSkills(ROOT).failures, []);
});

test("the vendor surface keeps its required shape", () => {
	assert.deepEqual(checkProviderShape(ROOT).failures, []);
});

test("no credential-shaped literal is committed", () => {
	const offenders: string[] = [];
	const patterns = [/\bsk-[A-Za-z0-9_-]{16,}/, /\bBearer\s+[A-Za-z0-9._-]{20,}/, /\b[A-Za-z0-9_-]{40,}\b(?=.*(key|token|secret))/i];
	walk(ROOT, (path) => {
		const relative = path.slice(ROOT.length + 1).split("\\").join("/");
		if (!/\.(ts|json|md|yaml|yml)$/.test(relative)) return;
		if (relative === "pnpm-lock.yaml") return;
		const source = readFileSync(path, "utf8");
		for (const pattern of patterns) if (pattern.test(source)) offenders.push(`${relative} matches ${pattern}`);
	});
	assert.deepEqual(offenders, []);
});

function walk(directory: string, visit: (path: string) => void): void {
	for (const entry of readdirSync(directory, { withFileTypes: true })) {
		if (entry.name === "node_modules" || entry.name === ".git" || entry.name === "dist") continue;
		const path = join(directory, entry.name);
		if (entry.isDirectory()) walk(path, visit);
		else if (entry.isFile() && statSync(path).size < 200_000) visit(path);
	}
}
