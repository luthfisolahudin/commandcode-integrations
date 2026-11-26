#!/usr/bin/env node
import { createServer } from "node:http";

import { collectQuota, handleQuotaRequest } from "@luthfisolahudin/ai-integrations-catalog";
import { packs } from "#provider";

function flagValue(args: readonly string[], name: string): string | undefined {
	const index = args.indexOf(name);
	if (index === -1) return undefined;
	const next = args[index + 1];
	return next === undefined || next.startsWith("--") ? undefined : next;
}

const args = process.argv.slice(2);
if (args.includes("--help") || args.includes("-h")) {
	console.log(`Usage: quota [--serve] [--host 127.0.0.1] [--port 8319] [--token <bearer>] [--provider-instance <id>]`);
	process.exit(0);
}

const serve = args.includes("--serve");
const host = flagValue(args, "--host") ?? process.env["AI_INTEGRATIONS_QUOTA_HOST"]?.trim() ?? "127.0.0.1";
const rawPort = flagValue(args, "--port") ?? process.env["AI_INTEGRATIONS_QUOTA_PORT"]?.trim() ?? "8319";
const port = Number(rawPort);
if (!Number.isInteger(port) || port < 0 || port > 65535) {
	console.error(`Invalid port: ${rawPort}`);
	process.exit(2);
}
const token = flagValue(args, "--token") ?? process.env["AI_INTEGRATIONS_QUOTA_TOKEN"]?.trim();
const providerInstanceId = flagValue(args, "--provider-instance") ?? process.env["T3_PROVIDER_INSTANCE_ID"]?.trim();

const quotaPacks = packs.filter((pack) => pack.hooks?.quota !== undefined);
if (quotaPacks.length === 0) {
	console.error("No provider pack in this repo implements quota reporting.");
	process.exit(1);
}

if (!serve) {
	const { response, errors } = await collectQuota(quotaPacks, {
		...(providerInstanceId ? { providerInstanceId } : {}),
	});
	for (const err of errors) {
		console.error(`${err.providerId}: ${err.error}`);
	}
	if (errors.length === quotaPacks.length) {
		process.exit(1);
	}
	process.stdout.write(`${JSON.stringify(response, null, 2)}\n`);
	process.exit(0);
}

const server = createServer((req, res) => {
	void handleQuotaRequest(
		{
			method: req.method ?? "GET",
			path: req.url ?? "/",
			...(typeof req.headers.authorization === "string" ? { authorization: req.headers.authorization } : {}),
		},
		{
			packs: quotaPacks,
			...(token ? { token } : {}),
			...(providerInstanceId ? { providerInstanceId } : {}),
		},
	)
		.then((reply) => {
			res.writeHead(reply.status, reply.headers);
			res.end(reply.body);
		})
		.catch((error) => {
			res.writeHead(500, { "Content-Type": "application/json; charset=utf-8" });
			res.end(JSON.stringify({ error: error instanceof Error ? error.message : String(error) }));
		});
});

server.listen(port, host, () => {
	const addr = server.address();
	const boundPort = typeof addr === "object" && addr !== null ? addr.port : port;
	const displayHost = host.includes(":") ? `[${host}]` : host;
	console.log(`T3 Code HTTP quota source listening on http://${displayHost}:${boundPort}`);
});

for (const signal of ["SIGINT", "SIGTERM"] as const) {
	process.on(signal, () => {
		server.close(() => process.exit(0));
	});
}
