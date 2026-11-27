#!/usr/bin/env node
/**
 * Re-captures `packages/provider/fixtures/` from the live Provider API.
 *
 *   pnpm capture:fixtures
 *
 * Writes three files, none of which carry credentials: the client view, the public
 * list, and their merge. The merge is produced by the same `mergeCatalog` the
 * adapter runs, so the committed fixture cannot disagree with the code that reads
 * it.
 *
 * Refuses to write a payload that looks partial — an empty view, or a merged count
 * that fell by more than 10%. A silently truncated catalog is worse than a stale
 * one, and the difference is invisible in a diff of 500 lines of JSON.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { resolveApiKey } from "../packages/runtime/catalog/src/index.ts";

import { commandCodePack, mergeCatalog, type ClientCatalog, type PublicModel } from "../packages/provider/src/index.ts";

const FIXTURES = join(import.meta.dirname, "..", "packages", "provider", "fixtures");
const DROP_LIMIT = 0.1;

const key = resolveApiKey(commandCodePack);
if (key === undefined) {
	console.error(`No key. Set ${commandCodePack.auth?.apiKeyEnv ?? "(none declared)"} or log in to CommandCode first.`);
	process.exit(2);
}

const base = commandCodePack.baseUrl.replace(/\/+$/, "");
const headers = {
	Authorization: `Bearer ${key}`,
	Accept: "application/json",
	...(commandCodePack.discovery.userAgent === undefined ? {} : { "User-Agent": commandCodePack.discovery.userAgent }),
};
const signal = AbortSignal.timeout(commandCodePack.discovery.timeoutMs ?? 30_000);

async function fetchJson(url: string): Promise<unknown> {
	const response = await fetch(url, { headers, signal });
	if (!response.ok) throw new Error(`${url} responded ${response.status}`);
	return response.json();
}

const [clientPayload, publicPayload] = await Promise.all([
	fetchJson(`${base}${commandCodePack.discovery.path}?view=client`),
	fetchJson(`${base}${commandCodePack.discovery.path}`),
]);

const client = clientPayload as ClientCatalog;
if (client.schemaVersion !== 1 || typeof client.catalogVersion !== "string" || !Array.isArray(client.data)) {
	throw new Error(`unsupported client catalog shape: schemaVersion ${String(client.schemaVersion)}`);
}
const publicModels = (Array.isArray(publicPayload) ? publicPayload : (publicPayload as { data?: PublicModel[] }).data) ?? [];
if (client.data.length === 0) throw new Error("client catalog is empty; refusing to overwrite the fixture");
if (publicModels.length === 0) throw new Error("public list is empty; refusing to overwrite the fixture");

const merged = mergeCatalog(client, publicModels);

function previousCount(): number | undefined {
	try {
		const payload = JSON.parse(readFileSync(join(FIXTURES, "catalog.json"), "utf8")) as { data?: unknown[] };
		return payload.data?.length;
	} catch {
		return undefined;
	}
}

const previous = previousCount();
if (previous !== undefined && merged.length < previous * (1 - DROP_LIMIT)) {
	throw new Error(`merged catalog fell from ${previous} to ${merged.length} models; refusing to overwrite`);
}

writeFileSync(join(FIXTURES, "client-catalog.json"), `${JSON.stringify(client, null, 2)}\n`);
writeFileSync(join(FIXTURES, "models.json"), `${JSON.stringify(publicPayload, null, 2)}\n`);
writeFileSync(join(FIXTURES, "catalog.json"), `${JSON.stringify({ object: "list", data: merged }, null, 2)}\n`);

const zdr = merged.filter((record) => record.zdr === true).length;
console.log(`captured ${client.data.length} client / ${publicModels.length} public → ${merged.length} merged (${zdr} ZDR-capable)`);
console.log(`catalogVersion ${client.catalogVersion}`);
console.log("now run: pnpm report --write && pnpm check");
