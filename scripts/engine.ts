import { execFileSync, execSync } from "node:child_process";
import { createHash } from "node:crypto";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { basename, dirname, join, posix, resolve } from "node:path";

interface EngineLock {
	tag: string;
	commit: string;
	packSchemaVersion: number;
	/** Files the tag owns, relative to the checkout root, each with its sha256. */
	files: Record<string, string>;
}

const LOCK = "engine.lock.json";
/** Trees copied verbatim into `engine/`, keyed by upstream path -> engine subdirectory. */
const sources = {
	"packages/contract/src": "contract",
	"packages/catalog/src": "catalog",
	"adapters/pi/src": "pi",
	"adapters/opencode/src": "opencode",
};

/**
 * Trees that stay where they are but are owned by the release: the CLI, the
 * conformance suite, and the engine's own tests. They used to be vendored copies
 * nothing verified, so they drifted from the tag one `engine:update` at a time.
 */
/** Files that only make sense where the example packs exist, i.e. upstream. */
const TEMPLATE_ONLY = /\/corpus\.test\.ts$/;

const managed = [
	"packages/contract/test",
	"packages/catalog/test",
	"packages/cli/src",
	"packages/cli/test",
	"packages/conformance/test",
];

function option(name: string) {
	const index = process.argv.indexOf(`--${name}`);
	const value = process.argv[index + 1];
	return index < 0 || value?.startsWith("--") ? undefined : value;
}

function required(name: string): string {
	const value = option(name)?.trim();
	if (!value) throw new Error(`--${name} is required`);
	return value;
}

function git(source: string, ...args: string[]) {
	return execFileSync("git", ["-C", source, ...args], { encoding: "utf8" });
}

function json(path: string, value: unknown) {
	writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}


/**
 * Rewrites a workspace specifier into a path relative to the copied tree.
 *
 * Three shapes have to survive: a whole package (`...-provider`), a subpath
 * (`...-pi/model`), and a file already inside the copied engine, which resolves
 * against its sibling packages. Provider stays in `packages/provider`, because
 * that is the one package a checkout owns.
 *
 * Targets are root-relative and `posix.relative` derives the hops, so a file's
 * depth never has to be counted by hand.
 */
function rewriteSpecifiers(body: string, relativeFile: string): string {
	const from = posix.dirname(relativeFile);
	// Only import specifiers are rewritten. A test that asserts on a package
	// *name* passes the string as an argument, and rewriting that would change what
	// the assertion means.
	return body.replace(
		/(\bfrom\s*|\bimport\s*\(\s*)"@luthfisolahudin\/[\w.-]*?-(catalog|contract|provider|pi|opencode|cli|conformance)(\/[^"]+)?"/g,
		(_match, prefix: string, dependency: string, subpath: string | undefined) => {
			const leaf = subpath === undefined ? "index.ts" : `${subpath.slice(1)}.ts`;
			// contract, catalog, pi and opencode are copied into engine/. provider is the
			// vendored package a checkout owns, and cli is a workspace package with a
			// src/ index. conformance has no public entry point at all.
			const target = dependency === "cli"
				? `packages/cli/src/${leaf}`
				: dependency === "provider"
					? `packages/provider/src/${leaf}`
					: `engine/${dependency}/${leaf}`;
			return `${prefix}${JSON.stringify(posix.relative(from, target).replace(/^(?!\.)/, "./"))}`;
		},
	);
}

function copyEngine(source: string, tag: string, destination: string, workspace: boolean): EngineLock {
	if (!/^v\d+\.\d+\.\d+(?:-[\w.-]+)?$/.test(tag)) throw new Error("Expected a version tag such as v2.0.0");
	const commit = git(source, "rev-parse", "--verify", `refs/tags/${tag}^{commit}`).trim();
	const pack = git(source, "show", `${commit}:packages/contract/src/pack.ts`);
	const packSchemaVersion = Number(/export const PACK_SCHEMA_VERSION = (\d+)/.exec(pack)?.[1]);
	if (!Number.isSafeInteger(packSchemaVersion)) throw new Error("Release has no pack schema version");

	const files: Record<string, string> = {};
	const write = (relativePath: string, body: string) => {
		const output = join(destination, relativePath);
		mkdirSync(dirname(output), { recursive: true });
		writeFileSync(output, body);
		files[relativePath] = createHash("sha256").update(body).digest("hex");
	};

	for (const [tree, subdirectory] of Object.entries(sources)) {
		const listing = git(source, "ls-tree", "-r", "--name-only", commit, "--", tree).trim();
		const selected = listing.length === 0 ? [] : listing.split("\n")
			.filter((path) => path.endsWith(".ts") && (!tree.startsWith("adapters/") || !path.endsWith("/index.ts")));
		if (selected.length === 0) throw new Error(`Release does not contain ${tree}`);
		for (const path of selected) {
			const relativePath = path.slice(tree.length + 1);
			const outputPath = `engine/${subdirectory}/${relativePath}`;
			write(outputPath, rewriteSpecifiers(git(source, "show", `${commit}:${path}`), outputPath));
		}
	}

	if (workspace) {
		for (const tree of managed) {
			const listing = git(source, "ls-tree", "-r", "--name-only", commit, "--", tree).trim();
			const selected = listing.length === 0 ? [] : listing.split("\n")
				.filter((path) => path.endsWith(".ts") && !TEMPLATE_ONLY.test(path));
			if (selected.length === 0) throw new Error(`Release does not contain ${tree}`);
			for (const path of selected) {
				write(path, rewriteSpecifiers(git(source, "show", `${commit}:${path}`), path));
			}
		}
	}

	for (const adapter of ["pi", "opencode"]) {
		if (!existsSync(join(destination, "engine", adapter, "provider.ts"))) throw new Error(`Release does not include the reusable ${adapter} adapter`);
	}
	write("engine/LICENSE", git(source, "show", `${commit}:LICENSE`));
	// The updater ships itself. Without this a checkout can never adopt a new lock
	// format: the old verify() rejects the new manifest before anything is written.
	write("scripts/engine.ts", readFileSync(new URL(import.meta.url), "utf8"));
	return { commit, tag, packSchemaVersion, files };
}

/**
 * Verifies every file the lock lists is present and unchanged.
 *
 * A whole-directory digest could only answer "is `engine/` intact"; the CLI and
 * the conformance suite live outside it, so they were unverified copies. Listing
 * each file makes an edit anywhere the release owns a lock violation.
 */
/** A lock predating the file manifest has one `digest` and no `files`. */
function isLegacyLock(destination: string): boolean {
	try {
		const lock = JSON.parse(readFileSync(join(destination, LOCK), "utf8")) as Partial<EngineLock>;
		return lock.files === undefined;
	} catch {
		return false;
	}
}

function verify(destination: string): EngineLock {
	const lock = JSON.parse(readFileSync(join(destination, LOCK), "utf8")) as EngineLock;
	if (lock.files === undefined || Object.keys(lock.files).length === 0) {
		throw new Error(`${LOCK} has no file manifest; regenerate it with engine:update`);
	}
	const drift: string[] = [];
	for (const [relativePath, expected] of Object.entries(lock.files)) {
		let body: string;
		try {
			body = readFileSync(join(destination, relativePath), "utf8");
		} catch {
			drift.push(`${relativePath} (missing)`);
			continue;
		}
		if (createHash("sha256").update(body).digest("hex") !== expected) drift.push(relativePath);
	}
	if (drift.length > 0) {
		const shown = drift.slice(0, 10).join("\n  ");
		throw new Error(`Copied engine differs from its lock:\n  ${shown}${drift.length > 10 ? `\n  … ${drift.length - 10} more` : ""}\nSee docs/SYNC.md.`);
	}
	return lock;
}

function generatedPackage(id: string) {
	return {
		name: `${id}-integrations`,
		private: true,
		type: "module",
		main: "./opencode.ts",
		exports: { ".": "./opencode.ts" },
		pi: { extensions: ["./pi.ts"] },
		engines: { node: ">=26" },
		packageManager: "pnpm@12.21.0",
		scripts: {
			check: "node scripts/engine.ts verify && tsc -p tsconfig.json",
			"check:catalog": "node check-catalog.ts",
			"engine:update": "node scripts/engine.ts update",
		},
		devDependencies: { "@types/node": "26.6.6", "typescript": "5.9.3" },
		dependencies: { "@earendil-works/pi-ai": "1.5.2", "@earendil-works/pi-coding-agent": "1.5.2", "@opencode/plugin": "2.2.7" },
	};
}

function init(source: string, tag: string, destination: string) {
	const id = required("id");
	const name = required("name");
	const baseUrl = new URL(required("base-url"));
	const apiKeyEnv = option("api-key-env");
	if (!/^[a-z][a-z0-9-]*$/.test(id)) throw new Error("Provider id needs lowercase letters, digits, or hyphens");
	if (!["http:", "https:"].includes(baseUrl.protocol) || baseUrl.username || baseUrl.password || baseUrl.search || baseUrl.hash)
		throw new Error("Expected an HTTP(S) base URL without credentials, query, or fragment");
	if (apiKeyEnv !== undefined && !/^[A-Z_][A-Z0-9_]*$/.test(apiKeyEnv)) throw new Error("Expected an environment variable name");
	if (existsSync(destination)) throw new Error("Destination must be a new directory");

	const temporary = mkdtempSync(join(dirname(destination), `.${basename(destination)}-`));
	try {
		const lock = copyEngine(source, tag, temporary, false);
		json(join(temporary, LOCK), lock);
		json(join(temporary, "package.json"), generatedPackage(id));
		json(join(temporary, "tsconfig.json"), { compilerOptions: {
			target: "ES2023", module: "NodeNext", lib: ["ES2023"], types: ["node"],
			allowImportingTsExtensions: true, noEmit: true, strict: true, skipLibCheck: true,
		} });
		mkdirSync(join(temporary, "scripts"), { recursive: true });
		mkdirSync(join(temporary, "fixtures"));
		json(join(temporary, "fixtures/catalog.json"), { data: [] });
		writeFileSync(join(temporary, ".gitignore"), "node_modules/\n.engine-updating/\n");
		writeFileSync(join(temporary, ".node-version"), "26.13.1\n");
		writeFileSync(join(temporary, ".gitattributes"), "* text=auto eol=lf\n");
		writeFileSync(join(temporary, "pnpm-workspace.yaml"), "allowBuilds:\n  '@google/genai': false\n  protobufjs: false\n");
		writeFileSync(join(temporary, "scripts/engine.ts"), readFileSync(new URL(import.meta.url)));
		const pack = {
			schemaVersion: lock.packSchemaVersion,
			id,
			name,
			baseUrl: baseUrl.href.replace(/\/+$/, ""),
			auth: apiKeyEnv === undefined ? { kind: "none" } : { kind: "bearer", apiKeyEnv },
			discovery: { path: "/models" },
		};
		writeFileSync(join(temporary, "provider.ts"), `import { definePack } from "./engine/contract/index.ts";\n\nexport const pack = definePack(${JSON.stringify(pack, null, 2)});\n`);
		for (const [file, folder, factory] of [
			["pi.ts", "pi", "createPiExtension"],
			["opencode.ts", "opencode", "createOpenCodePlugin"],
		]) {
			writeFileSync(join(temporary, file!), `import { ${factory} } from "./engine/${folder}/provider.ts";\nimport { pack } from "./provider.ts";\n\nexport default ${factory}(pack);\n`);
		}
		writeFileSync(join(temporary, "check-catalog.ts"), CHECK_CATALOG);
		writeFileSync(join(temporary, "README.md"), `# ${name}\n\nRun \`pnpm install --frozen-lockfile\` and \`pnpm check\`. Pi loads \`pi.ts\` as an extension. OpenCode loads this checkout directory as a file plugin.\n\nRun \`pnpm run check:catalog --live\` to verify discovery. Capture a sanitized catalog in \`fixtures/catalog.json\` for offline checks.\n\nUpdate with \`pnpm run engine:update --source <upstream-checkout> --tag <version>\`. Commit the engine and its lock together. Revert that commit to roll back.\n`);
		execSync("pnpm install --lockfile-only", { cwd: temporary, stdio: "inherit" });
		cpSync(temporary, destination, { recursive: true });
		rmSync(temporary, { recursive: true, force: true });
	} finally {
		rmSync(temporary, { recursive: true, force: true });
	}
}

function update(source: string, tag: string, destination: string) {
	const guard = join(destination, ".engine-updating");
	mkdirSync(guard);
	try {
		// A legacy lock cannot be verified against a per-file manifest, so the first
		// update out of one replaces the tree outright. It still runs the provider
		// repo's own `pnpm check`, and still restores the old lock on failure.
		if (isLegacyLock(destination)) {
			console.log("engine: replacing a pre-manifest lock; run \`git diff\` and commit the result");
			adoptLegacy(source, tag, destination);
			return;
		}
		replaceEngine(source, tag, destination);
	} finally {
		rmSync(guard, { recursive: true, force: true });
	}
}

function adoptLegacy(source: string, tag: string, destination: string) {
	const stage = mkdtempSync(join(dirname(destination), ".engine-adopt-"));
	const backup = join(stage, "backup");
	const lock = join(destination, LOCK);
	const previousLock = readFileSync(lock);
	try {
		const next = copyEngine(source, tag, join(stage, "new"), existsSync(join(destination, "packages", "cli", "package.json")));
		for (const relativePath of ["engine", ...Object.keys(next.files)]) {
			const from = join(destination, relativePath);
			if (!existsSync(from)) continue;
			const to = join(backup, relativePath);
			mkdirSync(dirname(to), { recursive: true });
			cpSync(from, to, { recursive: true });
		}
		rmSync(join(destination, "engine"), { recursive: true, force: true });
		for (const relativePath of Object.keys(next.files)) {
			const from = join(stage, "new", relativePath);
			const to = join(destination, relativePath);
			mkdirSync(dirname(to), { recursive: true });
			cpSync(from, to, { recursive: true });
		}
		json(lock, next);
		try {
			execSync("pnpm run check", { cwd: destination, stdio: "inherit" });
		} catch (error) {
			rmSync(join(destination, "engine"), { recursive: true, force: true });
			for (const relativePath of Object.keys(next.files)) {
				const to = join(destination, relativePath);
				const from = join(backup, relativePath);
				rmSync(to, { recursive: true, force: true });
				if (!existsSync(from)) continue;
				mkdirSync(dirname(to), { recursive: true });
				cpSync(from, to, { recursive: true });
			}
			rmSync(join(destination, "engine"), { recursive: true, force: true });
			const oldEngine = join(backup, "engine");
			if (existsSync(oldEngine)) cpSync(oldEngine, join(destination, "engine"), { recursive: true });
			writeFileSync(lock, previousLock);
			throw error;
		}
	} finally {
		rmSync(stage, { recursive: true, force: true });
	}
}

function replaceEngine(source: string, tag: string, destination: string) {
	const previous = verify(destination);
	const stage = mkdtempSync(join(dirname(destination), ".engine-update-"));
	const backup = join(stage, "backup");
	const lock = join(destination, LOCK);
	const previousLock = readFileSync(lock);
	// Every path the lock owns, plus the engine tree itself, is snapshotted first:
	// a failed check has to restore the CLI and the tests too, not just engine/.
	const owned = new Set([...Object.keys(previous.files), "engine"]);
	const touched = new Set<string>();
	try {
		const workspace = existsSync(join(destination, "packages", "cli", "package.json"));
		const next = copyEngine(source, tag, join(stage, "new"), workspace);
		if (next.packSchemaVersion !== previous.packSchemaVersion) throw new Error("Release requires a pack migration");

		for (const relativePath of Object.keys(next.files)) touched.add(relativePath);
		for (const relativePath of owned) touched.add(relativePath);
		for (const relativePath of touched) {
			const from = join(destination, relativePath);
			const to = join(backup, relativePath);
			if (!existsSync(from)) continue;
			mkdirSync(dirname(to), { recursive: true });
			cpSync(from, to, { recursive: true });
		}

		rmSync(join(destination, "engine"), { recursive: true, force: true });
		mkdirSync(join(destination, "engine"), { recursive: true });
		for (const relativePath of Object.keys(next.files)) {
			const from = join(stage, "new", relativePath);
			const to = join(destination, relativePath);
			mkdirSync(dirname(to), { recursive: true });
			cpSync(from, to, { recursive: true });
		}
		json(lock, next);

		try {
			execSync("pnpm run check", { cwd: destination, stdio: "inherit" });
		} catch (error) {
			rmSync(join(destination, "engine"), { recursive: true, force: true });
			for (const relativePath of touched) {
				const from = join(backup, relativePath);
				const to = join(destination, relativePath);
				rmSync(to, { recursive: true, force: true });
				if (!existsSync(from)) continue;
				mkdirSync(dirname(to), { recursive: true });
				cpSync(from, to, { recursive: true });
			}
			writeFileSync(lock, previousLock);
			throw error;
		}
	} finally {
		rmSync(stage, { recursive: true, force: true });
	}
}

const CHECK_CATALOG = `import { readFileSync } from "node:fs";
import { buildModels, discover, parseEnvelope } from "./engine/catalog/index.ts";
import { pack } from "./provider.ts";

try {
	const live = process.argv.includes("--live");
	const records = live
		? (await discover(pack)).raw
		: parseEnvelope(JSON.parse(readFileSync(new URL("./fixtures/catalog.json", import.meta.url), "utf8")));
	const models = buildModels(pack, records).filter((model) => model.excluded === undefined);
	console.log(JSON.stringify({ source: live ? "network" : "fixture", models }, null, 2));
} catch (error) {
	console.error(error instanceof Error ? error.message : String(error));
	process.exitCode = 1;
}
`;

try {
	const command = process.argv[2];
	const destination = resolve(option("dest") ?? process.cwd());
	if (command === "verify") console.log(`engine ${verify(destination).tag}: matches lock`);
	else if (command === "init") init(resolve(option("source") ?? process.cwd()), required("tag"), resolve(required("dest")));
	else if (command === "update") update(resolve(required("source")), required("tag"), destination);
	else throw new Error("Expected init, update, or verify");
} catch (error) {
	console.error(error instanceof Error ? error.message : String(error));
	process.exitCode = 1;
}
