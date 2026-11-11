/** Pi's thinking levels, in ascending order. */
export const PI_LEVELS = ["off", "minimal", "low", "medium", "high", "xhigh", "max"] as const;
export type PiLevel = (typeof PI_LEVELS)[number];

/** Levels that are addressable in `thinkingLevelMap`. */
export const PI_MAPPABLE_LEVELS: readonly PiLevel[] = PI_LEVELS;

/**
 * Why a probe could not answer the question. Billing and quota are not capability
 * answers: a 402 says the account cannot pay, not that the route ignores `max`.
 */
export type InconclusiveReason = "partial";

export interface EffortMenuInput {
	/** The wire value a probe measured. Absent means "not measured". */
	wireEffort?: string;
	/** `false` when the provider will not run without thinking. */
	canDisable?: boolean;
	/** Levels to expose. Defaults to the highest level only. */
	levels?: readonly PiLevel[];
	/** Extra levels that map to the same wire value, for measured aliases. */
	alias?: readonly PiLevel[];
}

/**
 * Builds Pi's `thinkingLevelMap` from measured evidence.
 *
 * Returns `undefined` when nothing was measured, which is the important case:
 * the model stays visible with no effort menu instead of advertising levels the
 * route may ignore, normalise, or invert. See `docs/THINKING.md`.
 *
 * Client `max` means "the highest effort this route actually applies", so by
 * default only `max` carries the wire value and every other level is `null`.
 */
export function effortMenu(input: EffortMenuInput): Record<PiLevel, string | null> | undefined {
	if (input.wireEffort === undefined || input.wireEffort.trim().length === 0) return undefined;
	const mapped = new Set<PiLevel>(input.levels ?? ["max"]);
	for (const level of input.alias ?? []) mapped.add(level);

	const menu = {} as Record<PiLevel, string | null>;
	for (const level of PI_LEVELS) {
		if (level === "off") {
			menu.off = input.canDisable === false || !mapped.has("off") ? null : "off";
			continue;
		}
		menu[level] = mapped.has(level) ? input.wireEffort : null;
	}
	return menu;
}

/** True when the model offers at least one non-null level. */
export function hasEffortMenu(menu: Record<PiLevel, string | null> | undefined): boolean {
	if (menu === undefined) return false;
	return PI_LEVELS.some((level) => menu[level] !== null);
}

/**
 * Builds a menu from levels a provider *declares* rather than from a measurement.
 *
 * models.dev publishes `reasoning_options: [{type:"effort", values:[...]}]`. That
 * is the vendor's own enum, so each declared level maps to itself. It is still a
 * declaration: if a probe later measures a different wire value, the measured
 * menu wins. `none` and `off` are treated as the disabled state.
 */
export function declaredEffortMenu(
	declared: readonly string[],
	canDisable: boolean | undefined,
): Record<PiLevel, string | null> | undefined {
	const values = declared.map((value) => value.trim().toLowerCase()).filter((value) => value.length > 0);
	if (values.length === 0) return undefined;
	const synonyms: Record<string, PiLevel> = { none: "off", off: "off", disable: "off", disabled: "off" };
	const byLevel = new Map<PiLevel, string>();
	for (const value of values) {
		const level = (synonyms[value] ?? value) as PiLevel;
		if (!PI_LEVELS.includes(level)) continue;
		byLevel.set(level, value);
	}
	if (byLevel.size === 0) return undefined;

	const disabled = canDisable === true || byLevel.has("off");
	const menu = {} as Record<PiLevel, string | null>;
	for (const level of PI_LEVELS) {
		if (level === "off") {
			menu.off = disabled ? (byLevel.get("off") ?? "off") : null;
			continue;
		}
		menu[level] = byLevel.get(level) ?? null;
	}
	return menu;
}
