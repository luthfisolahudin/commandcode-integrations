import assert from "node:assert/strict";
import { once } from "node:events";
import { mkdtempSync, rmSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import type { Provider } from "@earendil-works/pi-ai";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { PACK_SCHEMA_VERSION, definePack } from "@luthfisolahudin/ai-integrations-contract";

import { createPiExtension } from "../src/provider.ts";

test("a Pi refresh replaces startup models and accepts a live empty catalog", async (t) => {
	const directory = mkdtempSync(join(tmpdir(), "pi-model-refresh-"));
	const previous = process.env.XAI_CACHE_DIR;
	process.env.XAI_CACHE_DIR = directory;
	t.after(() => {
		if (previous === undefined) delete process.env.XAI_CACHE_DIR;
		else process.env.XAI_CACHE_DIR = previous;
		rmSync(directory, { recursive: true, force: true });
	});

	let ids = ["first", "second"];
	const server = createServer((_request, response) => {
		response.writeHead(200, { "content-type": "application/json" });
		response.end(JSON.stringify({ data: ids.map((id) => ({ id })) }));
	});
	server.listen(0, "127.0.0.1");
	await once(server, "listening");
	t.after(() => {
		server.closeAllConnections();
		server.close();
	});
	const address = server.address();
	assert.ok(address !== null && typeof address !== "string");
	const pack = definePack({
		schemaVersion: PACK_SCHEMA_VERSION,
		id: "fixture",
		name: "Fixture",
		baseUrl: `http://127.0.0.1:${address.port}`,
		auth: { kind: "none" },
		discovery: { path: "/models" },
		fallback: [{ id: "startup" }],
	});

	let provider: Provider | undefined;
	createPiExtension(pack)({ registerProvider(value: Provider) { provider = value; } } as unknown as ExtensionAPI);
	assert.ok(provider?.refreshModels);
	const modelIds = () => provider?.getModels().map(({ id }) => id);
	const refresh = () => provider!.refreshModels!({
		allowNetwork: true,
		force: true,
		signal: AbortSignal.timeout(3_000),
		async publish({ update }) {
			update?.();
			return true;
		},
	});

	assert.deepEqual(modelIds(), ["startup"]);
	await refresh();
	assert.deepEqual(modelIds(), ["first", "second"]);
	ids = ["second"];
	await refresh();
	assert.deepEqual(modelIds(), ["second"]);
	ids = [];
	await refresh();
	assert.deepEqual(modelIds(), []);
});
