#!/usr/bin/env node
import { execFileSync, execSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, relative, sep } from "node:path";

interface Lock {
	template: string;
	version: string;
	commit?: string;
	packSchemaVersion: number;
	identity: { name: string; description: string };
	owned: string[];
	deleted: string[];
}

const ROOT = process.cwd();
const LOCK_PATH = join(ROOT, "template.lock.json");
const apply = process.argv.includes("--apply");
const confirmed = process.argv.includes("--yes");
const version = argument("version");

function argument(name: string): string | undefined {
	const index = process.argv.indexOf(`--${name}`);
	if (index < 0) return undefined;
	const value = process.argv[index + 1];
	return value === undefined || value.startsWith("--") ? undefined : value;
}

function git(args: string[]): string {
	return execFileSync("git", args, { cwd: ROOT, encoding: "utf8" }).trim();
}

function inMerge(): boolean {
	return existsSync(join(ROOT, ".git", "MERGE_HEAD"));
}

if (!existsSync(LOCK_PATH)) {
	console.error("template.lock.json not found: this checkout is the template, not a downstream repo.");
	console.error("Downstream repos record the template version there; see docs/SYNC.md.");
	process.exit(2);
}

const lock = JSON.parse(readFileSync(LOCK_PATH, "utf8")) as Lock;
console.log(`template: ${lock.template}@${lock.version}`);
console.log(`identity: ${lock.identity.name}`);
console.log(`owned paths (never take the template's side): ${lock.owned.join(", ") || "(none)"}`);
console.log(`deleted paths (never resurrect): ${lock.deleted.join(", ") || "(none)"}`);

const dirty = git(["status", "--porcelain"]);
if (dirty.length > 0) {
	console.error("\nworking tree is not clean; commit or stash before syncing:");
	console.error(dirty);
	process.exit(2);
}

if (!apply) {
	console.log("\nDry run. Re-run with `--apply --yes --version <tag>` to merge a template tag.");
	process.exit(0);
}

if (version === undefined) {
	console.error("--apply requires --version <tag>");
	process.exit(2);
}
if (!confirmed) {
	console.error("--apply rewrites the working tree; pass --yes to confirm.");
	process.exit(2);
}

console.log(`\nfetching template tags...`);
git(["fetch", "template", "--tags", "--force"]);

// Resolve the tag to a commit explicitly. `template@v1.2.3` is not a git
// refspec, and a silent failure there used to bump the lock without merging.
let target: string;
try {
	target = git(["rev-parse", "--verify", `refs/tags/${version}^{commit}`]);
} catch {
	console.error(`tag ${version} is not present after fetching; nothing merged.`);
	process.exit(2);
}
console.log(`merging ${version} (${target.slice(0, 12)})...`);

try {
	execFileSync("git", ["merge", "--no-commit", target], { cwd: ROOT, stdio: "inherit" });
} catch {
	if (!inMerge()) {
		console.error("git merge failed before it could start; nothing merged, nothing committed.");
		process.exit(2);
	}
	// A conflict is expected; resolution below is deterministic for owned paths.
}

const conflicts = git(["diff", "--name-only", "--diff-filter=U"])
	.split("\n")
	.filter((line) => line.length > 0);

const prefixes = workspacePrefixes(target, lock);

for (const path of conflicts) {
	if (lock.owned.some((pattern) => matches(pattern, path))) {
		git(["checkout", "HEAD", "--", path]);
		git(["add", "--", path]);
		console.log(`kept ours: ${path}`);
		continue;
	}
	if (lock.deleted.some((pattern) => matches(pattern, path))) {
		git(["rm", "-f", "--", path]);
		console.log(`kept deletion: ${path}`);
		continue;
	}
	if (path === "pnpm-lock.yaml") {
		// A lockfile is regenerated, never merged: take the template's side as a
		// starting point and let the install below rewrite it.
		git(["checkout", "--theirs", "--", path]);
		git(["add", "--", path]);
		console.log("took the template lockfile; the install below regenerates it");
		continue;
	}
	if (path === "package.json") {
		resolveRootManifest(path);
		continue;
	}
	if (/^(packages|adapters|examples)\//.test(path)) {
		// Take the template's improvement, then put this repo's package prefix back.
		git(["checkout", "--theirs", "--", path]);
		const absolute = join(ROOT, path);
		const content = readFileSync(absolute, "utf8").split(prefixes.from).join(prefixes.to);
		writeFileSync(absolute, content);
		git(["add", "--", path]);
		console.log(`took template + restored prefix: ${path}`);
		continue;
	}
	console.error(`unresolved engine conflict: ${path}`);
}

const remaining = git(["diff", "--name-only", "--diff-filter=U"]).split("\n").filter((line) => line.length > 0);
if (remaining.length > 0) {
	console.error(`\n${remaining.length} conflict(s) need a human decision. Nothing was committed.`);
	process.exit(2);
}

// A clean merge can still introduce template-prefixed imports (a file that only
// the template touched), so the prefix is restored across the workspace, not
// only on conflicted paths.
const relabelled = restoreWorkspacePrefix(prefixes);
if (relabelled > 0) console.log(`restored this repo's prefix in ${relabelled} file(s)`);

const staged = git(["diff", "--cached", "--name-only"]).split("\n").filter((line) => line.length > 0);
console.log(`\n${staged.length} path(s) changed by the merge`);

// A merged lockfile is not a resolution: a template change can add a dependency
// (or a catalog entry) that the current node_modules does not have yet, so the
// gate installs first.
console.log("\ninstalling, then running `pnpm check` before committing...");
// A shell resolves the pnpm shim on every platform; execFile does not find the
// Windows .cmd wrapper. The commands are literals, so no input is interpolated.
execSync("pnpm install --no-frozen-lockfile", { cwd: ROOT, stdio: "inherit" });
execSync("pnpm check", { cwd: ROOT, stdio: "inherit" });

writeFileSync(LOCK_PATH, `${JSON.stringify({ ...lock, version, commit: target }, null, 2)}\n`);
git(["add", "template.lock.json"]);
execFileSync(
	"git",
	[
		"commit",
		"-m",
		`Sync template ${lock.template}@${version}`,
		"-m",
		`Template-Source: ${lock.template}@${version}`,
		"-m",
		`Merged ${target.slice(0, 12)}; ${staged.length} path(s) changed by the template.`,
	],
	{ cwd: ROOT, stdio: "inherit" },
);
console.log(`\nsynced to ${version}.`);

/**
 * Rewrites the template's package prefix to this repo's across the workspace and
 * stages whatever changed. Idempotent, so it also runs on a clean merge.
 */
function restoreWorkspacePrefix(prefixes: WorkspacePrefixes): number {
	let changed = 0;
	for (const file of [
		...walkSource(join(ROOT, "packages")),
		...walkSource(join(ROOT, "adapters")),
		...walkSource(join(ROOT, "examples")),
		join(ROOT, "tsconfig.json"),
	]) {
		if (!existsSync(file)) continue;
		const before = readFileSync(file, "utf8");
		if (!before.includes(prefixes.from)) continue;
		writeFileSync(file, before.split(prefixes.from).join(prefixes.to));
		git(["add", "--", relative(ROOT, file).split(sep).join("/")]);
		changed += 1;
	}
	return changed;
}

function walkSource(directory: string, files: string[] = []): string[] {
	if (!existsSync(directory)) return files;
	for (const entry of readdirSync(directory, { withFileTypes: true })) {
		const path = join(directory, entry.name);
		if (entry.isDirectory()) {
			if (entry.name === "node_modules" || entry.name === "dist") continue;
			walkSource(path, files);
		} else if (entry.isFile() && /\.(ts|json)$/.test(entry.name)) {
			files.push(path);
		}
	}
	return files;
}

function matches(pattern: string, path: string): boolean {
	if (!pattern.includes("*")) return pattern === path;
	const regex = new RegExp(`^${pattern.split("**").map(escapeRegExp).join(".*").replace(/\/\*$/, "(/.*)?")}$`);
	return regex.test(path);
}

interface WorkspacePrefixes {
	/** Package prefix of the incoming template, e.g. `@scope/template-`. */
	from: string;
	/** Package prefix of this repo, e.g. `@scope/cosmoshub-integrations-`. */
	to: string;
}

/**
 * Both sides renamed the workspace on purpose, so an engine conflict has to be
 * resolved as "their content, our prefix" rather than either side wholesale.
 */
function workspacePrefixes(target: string, lock: Lock): WorkspacePrefixes {
	const templateManifest = JSON.parse(
		git(["show", `${target}:package.json`]),
	) as { name?: string };
	const templateName = templateManifest.name ?? "";
	const scope = templateName.includes("/") ? templateName.split("/")[0]! : "@repo";
	const templateRoot = templateName.includes("/") ? templateName.split("/")[1]! : templateName;
	return { from: `${scope}/${templateRoot}-`, to: `${scope}/${lock.identity.name}-` };
}

/**
 * The root manifest mixes both owners: `name`/`description` are the repo's,
 * everything else is the template's (entrypoints, devEngines, scripts).
 */
function resolveRootManifest(path: string): void {
	const ours = JSON.parse(git(["show", `HEAD:${path}`])) as Record<string, unknown>;
	git(["checkout", "--theirs", "--", path]);
	const theirs = JSON.parse(readFileSync(join(ROOT, path), "utf8")) as Record<string, unknown>;
	const merged = { ...theirs };
	for (const key of ["name", "description"]) {
		if (ours[key] !== undefined) merged[key] = ours[key];
	}
	writeFileSync(join(ROOT, path), `${JSON.stringify(merged, null, 2)}\n`);
	git(["add", "--", path]);
	console.log(`merged root manifest: template fields, our identity (${String(ours["name"])})`);
}

function escapeRegExp(value: string): string {
	return value.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, "[^/]*");
}
