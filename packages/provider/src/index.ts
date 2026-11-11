import type { Pack } from "@luthfisolahudin/commandcode-integrations-contract";

import { commandCodePack } from "./pack.ts";
import { MEASURED_WIRE_EFFORT } from "./effort.ts";
import { CAPABILITY_INVARIANTS, type CapabilityInvariant } from "./invariants.ts";

export { commandCodePack };
export { MEASURED_WIRE_EFFORT } from "./effort.ts";
export { CAPABILITY_INVARIANTS } from "./invariants.ts";
export type { CapabilityInvariant } from "./invariants.ts";
export { mergeCatalog, resolveProtocol, normalizePricing } from "./catalog.ts";
export type { CommandCodeRecord, ClientCatalog, PublicModel } from "./catalog.ts";

/** The packs this repo ships. */
export const packs: readonly Pack[] = [commandCodePack];

/** Ids with a measured effort; empty until a route is probed. */
export const measuredIds: ReadonlySet<string> = new Set(Object.keys(MEASURED_WIRE_EFFORT));

export const invariants: readonly CapabilityInvariant[] = CAPABILITY_INVARIANTS;
