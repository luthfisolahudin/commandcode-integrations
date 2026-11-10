import type { ResolveProtocolInput, ResolveProtocolResult } from "./types.ts";

export function isClaudeModel(id: string, group?: string): boolean {
  return group?.toLowerCase() === "anthropic" || /^claude(?:[-.]|$)/i.test(id);
}

export function resolveProtocol(input: ResolveProtocolInput): ResolveProtocolResult {
  const endpoints = new Set(input.endpoints ?? []);

  if (isClaudeModel(input.id, input.group)) {
    return { protocol: "anthropic-messages", reason: "anthropic-model" };
  }

  if (endpoints.has("/chat/completions")) {
    return { protocol: "openai-chat", reason: "chat-supported" };
  }

  if (endpoints.size === 1 && endpoints.has("/messages")) {
    return { protocol: "anthropic-messages", reason: "messages-only" };
  }

  if (endpoints.has("/responses")) {
    return { protocol: "openai-responses", reason: "chat-unsupported" };
  }

  return { protocol: "openai-chat", reason: "default-unverified" };
}
