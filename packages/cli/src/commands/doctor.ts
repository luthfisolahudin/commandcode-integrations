#!/usr/bin/env node
import { runDoctorChecks } from "../lib/checks.ts";

const { failures, notes } = runDoctorChecks(process.cwd());
for (const note of notes) console.log(`  ${note}`);
if (failures.length > 0) {
	console.error(`\ndoctor: ${failures.length} failure(s)`);
	for (const failure of failures) console.error(`  ✖ ${failure}`);
	console.error("\nSee docs/SYNC.md for the symlink and AGENTS.md rules.");
	process.exit(1);
}
console.log("doctor: repository invariants hold");
