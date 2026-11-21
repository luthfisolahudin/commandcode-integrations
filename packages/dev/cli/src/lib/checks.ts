import { existsSync, lstatSync, readFileSync, readlinkSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

export interface CheckResult {
	failures: string[];
	notes: string[];
}

const AGENTS_REQUIRED_HEADINGS = [
	"# ",
	"## What this repo is",
	"## Read first",
	"## Packages and layers",
	"## Commands",
	"## Hard invariants",
	"## Change protocol",
];

const AGENTS_LINE_BUDGET = 220;

function isSymlink(path: string): boolean {
	try {
		return lstatSync(path).isSymbolicLink();
	} catch {
		return false;
	}
}

function linkTarget(path: string): string | undefined {
	try {
		return readlinkSync(path);
	} catch {
		return undefined;
	}
}

/** AGENTS.md is canonical; CLAUDE.md must be a symlink, not a copy or a stub. */
export function checkAgentFiles(root: string): CheckResult {
	const failures: string[] = [];
	const notes: string[] = [];
	const agentsPath = join(root, "AGENTS.md");
	const claudePath = join(root, "CLAUDE.md");

	if (!existsSync(agentsPath)) {
		failures.push("AGENTS.md is missing");
		return { failures, notes };
	}

	const agents = readFileSync(agentsPath, "utf8");
	const lineCount = agents.split("\n").length;
	if (lineCount > AGENTS_LINE_BUDGET) {
		failures.push(`AGENTS.md is ${lineCount} lines, over the ${AGENTS_LINE_BUDGET}-line budget`);
	}
	for (const heading of AGENTS_REQUIRED_HEADINGS) {
		if (!agents.includes(heading)) failures.push(`AGENTS.md is missing the "${heading.trim()}" section`);
	}

	if (!isSymlink(claudePath)) {
		const looksLikeStub = existsSync(claudePath) && readFileSync(claudePath, "utf8").trim() === "AGENTS.md";
		failures.push(
			looksLikeStub
				? "CLAUDE.md was checked out as a plain file containing \"AGENTS.md\"; restore the symlink (see docs/SYNC.md)"
				: "CLAUDE.md must be a symlink to AGENTS.md",
		);
	} else {
		const target = linkTarget(claudePath);
		if (target !== "AGENTS.md") failures.push(`CLAUDE.md points at "${target ?? "?"}", expected "AGENTS.md"`);
	}

	const claudeSkills = join(root, ".claude", "skills");
	if (!isSymlink(claudeSkills)) {
		failures.push(".claude/skills must be a directory symlink to ../.agents/skills");
	} else {
		// Windows returns a native path (`..\\.agents\\skills`); compare normalised.
		const target = (linkTarget(claudeSkills) ?? "").split("\\").join("/");
		if (target !== "../.agents/skills") {
			failures.push(`.claude/skills points at "${target}", expected "../.agents/skills"`);
		}
		if (!existsSync(join(root, ".agents", "skills"))) {
			failures.push(".agents/skills is missing");
		}
	}

	notes.push(`AGENTS.md: ${lineCount} lines`);
	return { failures, notes };
}

interface SkillFrontmatter {
	name?: string;
	description?: string;
}

function parseFrontmatter(source: string): SkillFrontmatter {
	if (!source.startsWith("---")) return {};
	const end = source.indexOf("\n---", 3);
	if (end === -1) return {};
	const block = source.slice(3, end);
	const result: SkillFrontmatter = {};
	for (const line of block.split("\n")) {
		const match = /^(name|description):\s*(.+)$/.exec(line.trim());
		if (match?.[1] === "name") result.name = match[2]?.trim();
		if (match?.[1] === "description") result.description = match[2]?.trim();
	}
	return result;
}

function taskNames(root: string): Set<string> {
	const names = new Set<string>();
	const taskfile = join(root, "Taskfile.yaml");
	if (!existsSync(taskfile)) {
		// A single-package repo may not use Taskfile; `package.json` scripts win.
		const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8")) as { scripts?: Record<string, string> };
		for (const key of Object.keys(pkg.scripts ?? {})) names.add(key);
		return names;
	}
	for (const line of readFileSync(taskfile, "utf8").split("\n")) {
		const match = /^ {2}([A-Za-z0-9:_-]+):\s*$/.exec(line);
		if (match?.[1] !== undefined) names.add(match[1]);
	}
	return names;
}

/**
 * Keeps skills honest: a skill that references a task which no longer exists is
 * a broken instruction, not documentation drift.
 */
export function checkSkills(root: string): CheckResult {
	const failures: string[] = [];
	const notes: string[] = [];
	const skillsDir = join(root, ".agents", "skills");
	if (!existsSync(skillsDir)) {
		return { failures: [".agents/skills is missing"], notes };
	}
	const tasks = taskNames(root);
	const skillDirs = readdirSync(skillsDir).filter((entry) => statSync(join(skillsDir, entry)).isDirectory());
	if (skillDirs.length === 0) failures.push(".agents/skills contains no skills");

	for (const dir of skillDirs) {
		const path = join(skillsDir, dir, "SKILL.md");
		if (!existsSync(path)) {
			failures.push(`${relative(root, path)} is missing`);
			continue;
		}
		const source = readFileSync(path, "utf8");
		const frontmatter = parseFrontmatter(source);
		if (frontmatter.name !== dir) failures.push(`${dir}/SKILL.md declares name "${frontmatter.name ?? ""}"`);
		const description = frontmatter.description ?? "";
		if (description.length === 0) failures.push(`${dir}/SKILL.md has no description`);
		if (description.length > 1024) failures.push(`${dir}/SKILL.md description exceeds 1024 characters`);

		for (const match of source.matchAll(/\btask ([a-z0-9:_-]+)/gi)) {
			const task = match[1];
			if (task !== undefined && !tasks.has(task)) {
				failures.push(`${dir}/SKILL.md references missing task "${task}"`);
			}
		}
		for (const match of source.matchAll(/`([a-z0-9._/-]+\/[a-z0-9._/-]+)`/gi)) {
			const candidate = match[1];
			if (candidate === undefined || candidate.startsWith("http")) continue;
			if (/^[@~]/.test(candidate)) continue;
			if (!existsSync(join(root, candidate)) && !candidate.includes("*")) {
				failures.push(`${dir}/SKILL.md references missing path "${candidate}"`);
			}
		}
		notes.push(`skill ${dir}: ok`);
	}
	return { failures, notes };
}

/** The vendor surface must stay small and in one place. */
export function checkProviderShape(root: string): CheckResult {
	const failures: string[] = [];
	const notes: string[] = [];
	const providerDir = join(root, "packages", "provider");
	for (const required of ["src/pack.ts", "src/invariants.ts", "src/effort.ts", "src/fallback.ts", "fixtures"]) {
		if (!existsSync(join(providerDir, required))) failures.push(`packages/provider/${required} is missing`);
	}
	if (!existsSync(join(root, "docs", "EVIDENCE.md"))) failures.push("docs/EVIDENCE.md is missing");
	return { failures, notes };
}

export function runDoctorChecks(root: string): CheckResult {
	const results = [checkAgentFiles(root), checkSkills(root), checkProviderShape(root)];
	return {
		failures: results.flatMap((result) => result.failures),
		notes: results.flatMap((result) => result.notes),
	};
}
