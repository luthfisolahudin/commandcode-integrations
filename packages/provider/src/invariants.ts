import type { ModelFacts } from "@luthfisolahudin/commandcode-integrations-contract";

export interface CapabilityInvariant {
	readonly id: string;
	readonly expected: Readonly<Record<string, boolean | number | string>>;
	readonly note: string;
}

/**
 * Ground truth for facts CommandCode's catalog cannot be trusted on.
 *
 * Empty: the catalog declares context, modalities and efforts per model, and this
 * repo has no vendor document that contradicts it. What matters here is routing,
 * which a per-model invariant cannot express; `docs/EVIDENCE.md` records the
 * endpoint evidence and `task probe:routes` re-checks it live.
 */
export const CAPABILITY_INVARIANTS: readonly CapabilityInvariant[] = [];

export type { ModelFacts };
