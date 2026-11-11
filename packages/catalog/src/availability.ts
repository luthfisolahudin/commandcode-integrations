import type { NormalizedModel, Pack } from "@luthfisolahudin/commandcode-integrations-contract";

/** Reasons a model is dropped from pickers. Recorded so nothing vanishes silently. */
export type ExclusionReason = "excluded-id" | "non-chat" | "offline";

/**
 * Decides whether a model should be hidden.
 *
 * `offline` is a real state on some aggregators (their own `/messages` route
 * answers `model_offline`), so advertising it would be a broken picker entry.
 */
export function exclusionReason(input: {
	pack: Pack;
	modelId: string;
	availability: NormalizedModel["availability"];
}): ExclusionReason | undefined {
	const filter = input.pack.filter;
	if ((filter?.excludeIds ?? []).includes(input.modelId)) return "excluded-id";
	if (filter?.nonChatPattern !== undefined && new RegExp(filter.nonChatPattern).test(input.modelId)) {
		return "non-chat";
	}
	if ((filter?.dropOffline ?? true) && input.availability === "offline") return "offline";
	return undefined;
}
