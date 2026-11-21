import { execFileSync, execSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { basename, dirname, join, posix, resolve } from "node:path";

interface EngineLock {
	tag: string;
	commit: string;
	packSchemaVersion: number;
	digest: string;
}

const LOCK = "engine.lock.json";
const sources = {
	"packages/contract/src": "contract",
	"packages/catalog/src": "catalog",
	"adapters/pi/src": "pi",
	"adapters/opencode/src": "opencode",
};

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

function copyEngine(source: string, tag: string, destination: string): EngineLock {
	if (!/^v\d+\.\d+\.\d+(?:-[\w.-]+)?$/.test(tag)) throw new Error("Expected a version tag such as v2.0.0");
	const commit = git(source, "rev-parse", "--verify", `refs/tags/${tag}^{commit}`).trim();
	const pack = git(source, "show", `${commit}:packages/contract/src/pack.ts`);
	const packSchemaVersion = Number(/export const PACK_SCHEMA_VERSION = (\d+)/.exec(pack)?.[1]);
	if (!Number.isSafeInteger(packSchemaVersion)) throw new Error("Release has no pack schema version");

	for (const [tree, subdirectory] of Object.entries(sources)) {
		const target = join(destination, subdirectory);
		mkdirSync(target, { recursive: true });
		const files = git(source, "ls-tree", "-r", "--name-only", commit, "--", tree).trim().split("\n");
		const selected = files.filter((path) => path.endsWith(".ts") && (!tree.startsWith("adapters/") || !path.endsWith("/index.ts")));
		if (selected.length === 0) throw new Error(`Release does not contain ${tree}`);
		for (const path of selected) {
			const relativePath = path.slice(tree.length + 1);
			const output = join(target, relativePath);
			mkdirSync(dirname(output), { recursive: true });
			const body = git(source, "show", `${commit}:${path}`).replace(
				/("@luthfisolahudin\/ai-provider-integrations-template-(catalog|contract)")/g,
				(_match, _specifier, dependency: string) => JSON.stringify(
					posix.relative(posix.dirname(`${subdirectory}/${relativePath}`), `${dependency}/index.ts`).replace(/^(?!\.)/, "./"),
				),
			);
			if (body.includes("@luthfisolahudin/ai-provider-integrations-template-")) throw new Error(`Unexpected workspace dependency in ${path}`);
			writeFileSync(output, body);
		}
	}
	for (const adapter of ["pi", "opencode"]) {
		if (!existsSync(join(destination, adapter, "provider.ts"))) throw new Error(`Release does not include the reusable ${adapter} adapter`);
	}
	writeFileSync(join(destination, "LICENSE"), git(source, "show", `${commit}:LICENSE`));
	return { commit, tag, packSchemaVersion, digest: engineDigest(destination) };
}

function engineDigest(engine: string) {
	const digest = createHash("sha256");
	function walk(directory: string, prefix: string) {
		for (const child of readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0)) {
			const path = join(directory, child.name);
			const name = prefix + child.name;
			if (child.isDirectory()) walk(path, name + "/");
			else if (child.isFile()) digest.update(JSON.stringify([name, createHash("sha256").update(readFileSync(path)).digest("hex")]));
			else throw new Error(`Unexpected entry in copied engine: ${name}`);
		}
	}
	if (!lstatSync(engine).isDirectory()) throw new Error("Expected an engine directory");
	walk(engine, "");
	return digest.digest("hex");
}

function verify(destination: string): EngineLock {
	const lock = JSON.parse(readFileSync(join(destination, LOCK), "utf8")) as EngineLock;
	if (engineDigest(join(destination, "engine")) !== lock.digest) throw new Error("Copied engine differs from its lock");
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
		engines: { node: ">=24" },
		packageManager: "pnpm@12.18.0",
		scripts: {
			check: "node scripts/engine.ts verify && tsc -p tsconfig.json",
			"check:catalog": "node check-catalog.ts",
			"engine:update": "node scripts/engine.ts update",
		},
		devDependencies: { "@types/node": "24.19.2", "typescript": "5.9.3" },
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
		const lock = copyEngine(source, tag, join(temporary, "engine"));
		json(join(temporary, LOCK), lock);
		json(join(temporary, "package.json"), generatedPackage(id));
		json(join(temporary, "tsconfig.json"), { compilerOptions: {
			target: "ES2023", module: "NodeNext", lib: ["ES2023"], types: ["node"],
			allowImportingTsExtensions: true, noEmit: true, strict: true, skipLibCheck: true,
		} });
		mkdirSync(join(temporary, "scripts"));
		mkdirSync(join(temporary, "fixtures"));
		json(join(temporary, "fixtures/catalog.json"), { data: [] });
		writeFileSync(join(temporary, ".gitignore"), "node_modules/\n.engine-updating/\n");
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
		renameSync(temporary, destination);
	} finally {
		rmSync(temporary, { recursive: true, force: true });
	}
}

function update(source: string, tag: string, destination: string) {
	const guard = join(destination, ".engine-updating");
	mkdirSync(guard);
	try {
		replaceEngine(source, tag, destination);
	} finally {
		rmSync(guard, { recursive: true, force: true });
	}
}

function replaceEngine(source: string, tag: string, destination: string) {
	const previous = verify(destination);
	const stage = mkdtempSync(join(dirname(destination), ".engine-update-"));
	const engine = join(destination, "engine");
	const previousEngine = join(stage, "old");
	const lock = join(destination, LOCK);
	const previousLock = readFileSync(lock);
	try {
		const next = copyEngine(source, tag, join(stage, "new"));
		if (next.packSchemaVersion !== previous.packSchemaVersion) throw new Error("Release requires a pack migration");
		renameSync(engine, previousEngine);
		try {
			renameSync(join(stage, "new"), engine);
			json(lock, next);
			execSync("pnpm run check", { cwd: destination, stdio: "inherit" });
		} catch (error) {
			rmSync(engine, { recursive: true, force: true });
			renameSync(previousEngine, engine);
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
