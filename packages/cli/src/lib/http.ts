import type { Pack } from "@luthfisolahudin/commandcode-integrations-contract";

/** Resolves the key for a live call without ever logging it. */
export function resolveKey(pack: Pack, env: NodeJS.ProcessEnv = process.env): string | undefined {
	const name = pack.auth?.apiKeyEnv;
	if (pack.auth?.apiKey !== undefined) return pack.auth.apiKey;
	if (name === undefined) return undefined;
	const value = env[name];
	return value === undefined || value.trim().length === 0 ? undefined : value.trim();
}
