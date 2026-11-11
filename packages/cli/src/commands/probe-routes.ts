#!/usr/bin/env node
import { packs } from "@luthfisolahudin/commandcode-integrations-provider";

import { resolveKey } from "../lib/http.ts";

const packId = process.argv.includes("--pack") ? process.argv[process.argv.indexOf("--pack") + 1] : packs[0]?.id;
const pack = packs.find((entry) => entry.id === packId);
if (pack === undefined) {
	console.error(`unknown pack: ${packId ?? "(none)"}`);
	process.exit(2);
}

const key = resolveKey(pack);
if (key === undefined) {
	console.error(`no API key: set ${pack.auth?.apiKeyEnv ?? "(none declared)"}`);
	process.exit(2);
}

const baseUrl = pack.baseUrl.replace(/\/+$/, "");
const routes = ["/chat/completions", "/messages", "/responses"];

for (const route of routes) {
	const response = await fetch(`${baseUrl}${route}`, {
		method: "POST",
		headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
		body: JSON.stringify({}),
		signal: AbortSignal.timeout(20_000),
	});
	const body = await response.text().catch(() => "");
	const verdict =
		response.status === 404
			? "absent"
			: response.status === 400 || response.status === 422
				? "present"
				: response.status === 401 || response.status === 403
					? "present (auth rejected)"
					: `unexpected ${response.status}`;
	console.log(`${pack.id} ${route}: ${response.status} -> ${verdict}`);
	if (response.status === 404) console.log(`  body: ${body.slice(0, 160).replace(/\s+/g, " ")}`);
}

console.log("\nA 400 on an empty body means the route exists but the payload was rejected.");
