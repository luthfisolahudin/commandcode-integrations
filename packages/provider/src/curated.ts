import type { ModelFacts } from "@luthfisolahudin/commandcode-integrations-contract";

/**
 * Facts the catalog cannot express.
 *
 * Empty: CommandCode's client catalog declares context, modalities, efforts and
 * pricing per model, so there is nothing to fill in. An entry here would override a
 * declaration, which needs vendor-document evidence in `docs/EVIDENCE.md`.
 */
export const curated: Record<string, Partial<ModelFacts>> = {};
