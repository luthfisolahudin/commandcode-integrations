/**
 * Measured wire effort per model.
 *
 * Empty on purpose: CommandCode declares `reasoningEfforts` per model in its own
 * catalog, which is the strongest kind of declaration and already drives the menu
 * (provenance `catalog`). A probe would be needed only to prove the route *honours*
 * a level, not to discover which levels exist.
 */
export const MEASURED_WIRE_EFFORT: Readonly<Record<string, string>> = {};
