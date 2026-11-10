import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export interface CommandCodeAuthOptions {
  env?: Record<string, string | undefined>;
  home?: string;
}

function readJson(path: string): Record<string, unknown> | null {
  try {
    const parsed: unknown = JSON.parse(readFileSync(path, "utf8"));
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    // Missing or malformed auth files are treated as no auth.
  }
  return null;
}

function normalizedKey(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const key = value.trim();
  return key ? key : null;
}

function keyFromPiAuth(path: string): string | null {
  const data = readJson(path);
  if (!data) return null;
  const direct = normalizedKey(data.apiKey);
  if (direct) return direct;
  if (Array.isArray(data.apiKeys)) {
    for (const entry of data.apiKeys) {
      const key = normalizedKey(entry);
      if (key) return key;
    }
  }
  return null;
}

function keyFromCliAuth(path: string): string | null {
  const data = readJson(path);
  return data ? normalizedKey(data.apiKey) : null;
}

export function resolveCommandCodeKey(options: CommandCodeAuthOptions = {}): string | null {
  const env = options.env ?? process.env;
  const home = options.home ?? homedir();

  const fromEnv = normalizedKey(env.COMMANDCODE_API_KEY);
  if (fromEnv) return fromEnv;

  const fromPi = keyFromPiAuth(join(home, ".pi", "agent", "commandcode", "auth.json"));
  if (fromPi) return fromPi;

  return keyFromCliAuth(join(home, ".commandcode", "auth.json"));
}
