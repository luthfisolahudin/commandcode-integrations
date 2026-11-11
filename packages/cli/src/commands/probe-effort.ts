#!/usr/bin/env node
import { decideEffort, PI_LEVELS, type ProbeSample } from "@luthfisolahudin/commandcode-integrations-contract";
import { MEASURED_WIRE_EFFORT, packs } from "@luthfisolahudin/commandcode-integrations-provider";

import { resolveKey } from "../lib/http.ts";

function argument(name: string): string | undefined {
	const index = process.argv.indexOf(`--${name}`);
	if (index === -1) return undefined;
	const value = process.argv[index + 1];
	return value === undefined || value.startsWith("--") ? undefined : value;
}

const packId = argument("pack") ?? packs[0]?.id;
const pack = packs.find((entry) => entry.id === packId);
if (pack === undefined) {
	console.error(`unknown pack: ${packId ?? "(none)"}`);
	process.exit(2);
}

const model = argument("model");
if (model === undefined) {
	console.error("usage: task probe:effort -- --model <id> [--levels low,high,max] [--samples 3]");
	process.exit(2);
}

const key = resolveKey(pack);
if (key === undefined) {
	console.error(`no API key: set ${pack.auth?.apiKeyEnv ?? "(none declared)"}`);
	process.exit(2);
}

const levels = (argument("levels") ?? "minimal,low,medium,high,xhigh,max").split(",").filter((level) => level.length > 0);
const samplesPerLevel = Number(argument("samples") ?? "3");
const baseUrl = pack.baseUrl.replace(/\/+$/, "");
const samples: ProbeSample[] = [];

for (const level of levels) {
	for (let attempt = 0; attempt < samplesPerLevel; attempt += 1) {
		const response = await fetch(`${baseUrl}/chat/completions`, {
			method: "POST",
			headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
			body: JSON.stringify({
				model,
				messages: [{ role: "user", content: "Reply with the single word: ok" }],
				max_tokens: 32,
				stream: false,
				reasoning_effort: level,
			}),
			signal: AbortSignal.timeout(60_000),
		});
		const body = (await response.json().catch(() => ({}))) as {
			usage?: { reasoning_tokens?: number; completion_tokens_details?: { reasoning_tokens?: number } };
			choices?: { finish_reason?: string; message?: { reasoning_content?: string } }[];
		};
		samples.push({
			level,
			status: response.status,
			// `PI_LEVELS` is only used to keep the ordering stable in the log.
			finishReason: body.choices?.[0]?.finish_reason,
			reasoningTokens:
				body.usage?.reasoning_tokens ?? body.usage?.completion_tokens_details?.reasoning_tokens,
			reasoningChars: body.choices?.[0]?.message?.reasoning_content?.length,
		});
	}
}

const verdict = decideEffort(samples);
console.log(JSON.stringify({ pack: pack.id, model, verdict, samples }, null, 2));
console.log("");

const evidence = verdict.verdict === "unsupported" || verdict.verdict === "inconclusive" ? undefined : verdict;
console.log("Evidence line for docs/EVIDENCE.md:");
console.log(
	`- ${new Date().toISOString().slice(0, 10)} \`${pack.id}/${model}\`: verdict \`${verdict.verdict}\`` +
		(verdict.verdict === "mapped" || verdict.verdict === "inverted" ? `, wire \`${verdict.wire}\`` : "") +
		(verdict.verdict === "inconclusive" ? ` (${verdict.reason}: ${JSON.stringify(verdict.statuses)})` : "") +
		`, signals ${JSON.stringify(evidence?.signals ?? {})}, noise floor ${evidence?.noiseFloor ?? "-"}.`,
);

if (verdict.verdict === "inconclusive") {
	console.error("\nThis probe did not answer the question.");
	if (verdict.reason === "blocked") {
		console.error(`  A level was rejected for a non-capability reason: ${JSON.stringify(verdict.statuses)}`);
		console.error("  402/429/5xx are billing, quota, or outage: fix that and re-run. Nothing was measured.");
	} else {
		console.error("  Fewer than two levels were accepted, so there is nothing to compare.");
	}
	process.exitCode = 3;
}

if (verdict.verdict === "mapped") {
	const current = MEASURED_WIRE_EFFORT[model];
	console.log(
		current === undefined
			? `\nNext: add \`"${model}": "${verdict.wire}"\` to packages/provider/src/effort.ts, then run task check:catalog.`
			: `\nCurrent entry is "${current}"; ${current === verdict.wire ? "it matches the evidence" : "the evidence disagrees"}.`,
	);
}
console.log(`\nlevels probed: ${PI_LEVELS.filter((level) => levels.includes(level)).join(", ") || levels.join(", ")}`);
