import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

import type { RawRecord } from "@luthfisolahudin/commandcode-integrations-contract";

export const CACHE_ROOT = "ai-provider-integrations";

export interface Snapshot {
	checkedAt: number;
	etag?: string;
	catalogVersion?: string;
	raw: RawRecord[];
}

export interface CacheLocationOptions {
	providerId: string;
	env?: NodeJS.ProcessEnv;
	platform?: NodeJS.Platform;
	home?: string;
}

/** XDG on POSIX, `%LOCALAPPDATA%` on Windows. Never inside the repo checkout. */
export function cacheDirectory(options: {
	env?: NodeJS.ProcessEnv;
	platform?: NodeJS.Platform;
	home?: string;
} = {}): string {
	const env = options.env ?? process.env;
	const platform = options.platform ?? process.platform;
	const home = options.home ?? homedir();
	if (env["XAI_CACHE_DIR"] !== undefined && env["XAI_CACHE_DIR"].trim().length > 0) {
		return join(env["XAI_CACHE_DIR"], CACHE_ROOT);
	}
	if (platform === "win32") {
		const local = env["LOCALAPPDATA"];
		if (local !== undefined && local.trim().length > 0) return join(local, CACHE_ROOT);
		return join(home, "AppData", "Local", CACHE_ROOT);
	}
	const xdg = env["XDG_CACHE_HOME"];
	if (xdg !== undefined && xdg.trim().length > 0) return join(xdg, CACHE_ROOT);
	return join(home, ".cache", CACHE_ROOT);
}

function safeName(providerId: string): string {
	return providerId.replace(/[^a-zA-Z0-9._-]/g, "_");
}

export function snapshotPath(options: CacheLocationOptions): string {
	return join(cacheDirectory(options), `${safeName(options.providerId)}.json`);
}

/** Returns `undefined` on a missing or corrupt snapshot: a cache is a hint, not truth. */
export function readSnapshot(path: string): Snapshot | undefined {
	try {
		const parsed = JSON.parse(readFileSync(path, "utf8")) as Partial<Snapshot>;
		if (typeof parsed.checkedAt !== "number" || !Array.isArray(parsed.raw)) return undefined;
		return {
			checkedAt: parsed.checkedAt,
			...(typeof parsed.etag === "string" ? { etag: parsed.etag } : {}),
			...(typeof parsed.catalogVersion === "string" ? { catalogVersion: parsed.catalogVersion } : {}),
			raw: parsed.raw as RawRecord[],
		};
	} catch {
		return undefined;
	}
}

/**
 * Writes atomically (temp file + rename) so a crashed process cannot leave a
 * half-written snapshot that the next start would trust.
 */
export function writeSnapshot(path: string, snapshot: Snapshot): void {
	const temporary = `${path}.${process.pid}.tmp`;
	try {
		mkdirSync(dirname(path), { recursive: true });
		writeFileSync(temporary, JSON.stringify(snapshot));
		renameSync(temporary, path);
	} catch {
		// A cache write must never fail discovery.
		try {
			rmSync(temporary, { force: true });
		} catch {
			// ignore
		}
	}
}

export function isFresh(snapshot: Snapshot, ttlMs: number, now = Date.now()): boolean {
	return now >= snapshot.checkedAt && now - snapshot.checkedAt < ttlMs;
}

/** Where the models.dev hint snapshot lives, next to the provider snapshots. */
export function modelsDevCachePath(options: { env?: NodeJS.ProcessEnv; platform?: NodeJS.Platform; home?: string } = {}): string {
	return join(cacheDirectory(options), "models.dev.json");
}
