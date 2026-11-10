import type {
  CommandCodeEffort,
  CommandCodeProtocol,
  OpenCodeVariant,
} from "./types.ts";

export const PI_THINKING_LEVELS = [
  "off",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
] as const;

export type PiThinkingLevel = (typeof PI_THINKING_LEVELS)[number];

export type PiThinkingMap = Record<PiThinkingLevel, string | null>;

function protocolOffValue(protocol: CommandCodeProtocol): string {
  if (protocol === "openai-responses") return "none";
  return "off";
}

export function toPiThinkingMap(
  efforts: readonly CommandCodeEffort[],
  protocol: CommandCodeProtocol,
): PiThinkingMap {
  const supported = new Set(efforts);
  const map = {} as PiThinkingMap;

  for (const level of PI_THINKING_LEVELS) {
    if (level === "off") {
      map.off = supported.has("off") ? protocolOffValue(protocol) : null;
      continue;
    }

    if (level === "minimal") {
      map.minimal = supported.has("low") ? "low" : null;
      continue;
    }

    map[level] = supported.has(level) ? level : null;
  }

  return map;
}

export function toOpenCodeVariants(
  efforts: readonly CommandCodeEffort[],
  protocol: CommandCodeProtocol,
): OpenCodeVariant[] {
  const variants: OpenCodeVariant[] = [];

  for (const effort of efforts) {
    if (effort === "off") {
      if (protocol === "anthropic-messages") {
        variants.push({
          id: "none",
          settings: { thinking: { type: "disabled" } },
        });
      } else {
        variants.push({
          id: "none",
          settings: { reasoningEffort: protocolOffValue(protocol) },
        });
      }
      continue;
    }

    if (protocol === "anthropic-messages") {
      variants.push({
        id: effort,
        settings: {
          thinking: { type: "adaptive", display: "summarized" },
          effort,
        },
      });
      continue;
    }

    variants.push({
      id: effort,
      settings: { reasoningEffort: effort },
    });
  }

  return variants;
}
