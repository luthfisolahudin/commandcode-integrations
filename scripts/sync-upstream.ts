#!/usr/bin/env node
// Runs from a temp dir on purpose: the repo's devEngines.packageManager pin
// makes npx refuse to run inside a pnpm workspace.
import { execSync } from "node:child_process";
import { cpSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const tag = process.argv[process.argv.indexOf("--tag") + 1];
if (!tag || tag.startsWith("--")) throw new Error("--tag <version> is required");
const stage = mkdtempSync(join(tmpdir(), "sync-upstream-"));
try {
	for (const marker of ["runtime", "dev"]) {
		const target = marker; // relative to the stage cwd
		execSync(`npx --yes degit luthfisolahudin/ai-integrations/packages/${marker}#${tag} ${target} --force`, { cwd: stage, stdio: "inherit", timeout: 120000, env: { ...process.env, npm_config_yes: "true" } });
		rmSync(`packages/${marker}`, { recursive: true, force: true });
		cpSync(join(stage, marker), `packages/${marker}`, { recursive: true });
	}
	execSync(`node scripts/verify-upstream.ts --write --tag ${tag}`, { stdio: "inherit" });
	console.log("copied and locked; now run: pnpm check");
} finally {
	rmSync(stage, { recursive: true, force: true });
}
