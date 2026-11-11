#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { cpSync, existsSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Turns the template checkout into a provider repo.
 *
 * The plan is computed first and printed; `--yes` is required to execute, so a
 * mistyped flag can never prune `examples/` by accident.
 */
const ROOT = process.cwd();

function argument(name: string): string | undefined {
	const index = process.argv.indexOf(`--${name}`);
	if (index < 0) return undefined;
	const value = process.argv[index + 1];
	return value === undefined || value.startsWith("--") ? undefined : value;
}

const id = argument("id");
const name = argument("name");
const baseUrl = argument("base-url");
const apiKeyEnv = argument("api-key-env");
const tier = argument("tier") ?? "a";
const execute = process.argv.includes("--yes");

if (id === undefined || name === undefined || baseUrl === undefined) {
	console.error("usage: task init -- --id <id> --name <name> --base-url <url> --api-key-env <ENV> [--tier a|b|c] --yes");
	process.exit(2);
}
if (!["a", "b", "c"].includes(tier)) {
	console.error(`unknown tier: ${tier} (expected a, b, or c)`);
	process.exit(2);
}

const rootManifestPath = join(ROOT, "package.json");
const rootManifest = JSON.parse(readFileSync(rootManifestPath, "utf8")) as { name?: string; description?: string };
const currentName = rootManifest.name ?? "";
const [scope, oldRoot] = currentName.includes("/") ? (currentName.split("/") as [string, string]) : ["@repo", currentName];
const newRoot = `${id}-integrations`;

const plan = [
	`rename workspace packages → ${scope}/${newRoot}-*`,
	`set root name → ${scope}/${newRoot}`,
	`seed the tier-${tier} pack into packages/provider/src/pack.ts`,
	"render README.md",
	"delete examples/ and the template-only corpus test",
	`write template.lock.json (version ${currentVersion()})`,
];

console.log(`provider: ${id} (${name})`);
console.log(`base:     ${baseUrl}`);
console.log(`key env:  ${apiKeyEnv ?? "(none)"}`);
for (const step of plan) console.log(`  - ${step}`);

if (!execute) {
	console.log("\nDry run. Re-run with --yes to apply.");
	process.exit(0);
}

const renamed = renameWorkspacePackages(scope, oldRoot, newRoot);
console.log(`renamed ${renamed} file(s) to ${scope}/${newRoot}-*`);

rootManifest.name = `${scope}/${newRoot}`;
rootManifest.description = `Live model discovery and OpenAI Chat Completions for ${name}`;
writeFileSync(rootManifestPath, `${JSON.stringify(rootManifest, null, 2)}\n`);

writeFileSync(
	join(ROOT, "README.md"),
	`# ${newRoot}\n\nLive model discovery and OpenAI Chat Completions for ${name}, shared by Pi and OpenCode.\n\n- base URL: \`${baseUrl}\`\n- API key: \`${apiKeyEnv ?? "(none)"}\`\n\n## Install\n\n\`\`\`\nPi        → ${join(ROOT, "adapters/pi/src/index.ts")}\nOpenCode  → ${join(ROOT, "adapters/opencode/src/index.ts")}\n\`\`\`\n\n## Verify\n\n\`\`\`sh\ntask check\ntask check:catalog\ntask report --write\n\`\`\`\n`,
);

if (tier !== "a") {
	const source = join(ROOT, "examples", `tier-${tier}`, "src", "pack.ts");
	const fixture = join(ROOT, "examples", `tier-${tier}`, "fixtures", "catalog.json");
	if (!existsSync(source)) {
		console.error(`tier-${tier} sources are missing; keep the current pack and copy by hand.`);
	} else {
		cpSync(source, join(ROOT, "packages/provider/src/pack.ts"), { force: true });
		if (existsSync(fixture)) cpSync(fixture, join(ROOT, "packages/provider/fixtures/catalog.json"), { force: true });
	}
}

rmSync(join(ROOT, "examples"), { recursive: true, force: true });
// The corpus test imports the example packs, so it goes with them.
rmSync(join(ROOT, "packages/conformance/test/corpus.test.ts"), { force: true });

// Drop the example dependencies so `pnpm install` still resolves.
const conformancePackagePath = join(ROOT, "packages/conformance/package.json");
const conformancePackage = JSON.parse(readFileSync(conformancePackagePath, "utf8")) as {
	dependencies?: Record<string, string>;
};
const dependencies = conformancePackage.dependencies ?? {};
for (const dependency of Object.keys(dependencies)) {
	if (dependency.includes("-tier-")) delete dependencies[dependency];
}
writeFileSync(conformancePackagePath, `${JSON.stringify(conformancePackage, null, 2)}\n`);

// Same for the typecheck path map.
const tsconfigPath = join(ROOT, "tsconfig.json");
const tsconfig = JSON.parse(readFileSync(tsconfigPath, "utf8")) as {
	compilerOptions: { paths?: Record<string, string[]> };
};
for (const specifier of Object.keys(tsconfig.compilerOptions.paths ?? {})) {
	if (specifier.includes("-tier-")) delete tsconfig.compilerOptions.paths?.[specifier];
}
writeFileSync(tsconfigPath, `${JSON.stringify(tsconfig, null, 2)}\n`);

const workspacePath = join(ROOT, "pnpm-workspace.yaml");
const workspace = readFileSync(workspacePath, "utf8").replace(/\n\s*- "examples\/\*"/, "");
writeFileSync(workspacePath, workspace);

writeFileSync(
	join(ROOT, "template.lock.json"),
	`${JSON.stringify(
		{
			template: "luthfisolahudin/ai-provider-integrations-template",
			version: currentVersion(),
			packSchemaVersion: 1,
			identity: { name: newRoot, description: rootManifest.description },
			owned: [
				"README.md",
				"LICENSE",
				"SECURITY.md",
				"packages/provider/**",
				"docs/EVIDENCE.md",
				"docs/PROVIDERS.md",
				"docs/REPO.md",
				"package.json#name",
				"package.json#description",
			],
			deleted: ["examples/**"],
		},
		null,
		2,
	)}\n`,
);

console.log("\ninitialised. Next: task check, then capture a real payload into packages/provider/fixtures/.");

/**
 * Renames every workspace package from the template's name to this repo's.
 *
 * The convention is `<scope>/<repo>-<suffix>`, so the rename is one string
 * substitution applied to package names, import specifiers, and the tsconfig
 * path map. It is idempotent: a repo already using the new prefix changes
 * nothing.
 */
function renameWorkspacePackages(scopePrefix: string, from: string, to: string): number {
	const needle = `${scopePrefix}/${from}-`;
	const replacement = `${scopePrefix}/${to}-`;
	let changed = 0;
	const files = [
		...walk(join(ROOT, "packages")),
		...walk(join(ROOT, "adapters")),
		...walk(join(ROOT, "examples")),
		join(ROOT, "tsconfig.json"),
	];
	for (const file of files) {
		const before = readFileSync(file, "utf8");
		if (!before.includes(needle)) continue;
		writeFileSync(file, before.split(needle).join(replacement));
		changed += 1;
	}
	return changed;
}

function walk(directory: string, files: string[] = []): string[] {
	if (!existsSync(directory)) return files;
	for (const entry of readdirSync(directory, { withFileTypes: true })) {
		const path = join(directory, entry.name);
		if (entry.isDirectory()) {
			if (entry.name === "node_modules" || entry.name === "dist") continue;
			walk(path, files);
		} else if (entry.isFile() && /\.(ts|json)$/.test(entry.name)) {
			files.push(path);
		}
	}
	return files;
}

function currentVersion(): string {
	try {
		return execFileSync("git", ["describe", "--tags", "--always"], { cwd: ROOT, encoding: "utf8" }).trim();
	} catch {
		return "0.1.0";
	}
}
