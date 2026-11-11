import type { FieldAliases } from "./pack.ts";
import type { Availability, Modality, OutputModality, RawRecord } from "./record.ts";

/** Reads a dotted path. Arrays are not traversed; this is for plain objects only. */
export function readPath(record: RawRecord, path: string): unknown {
	let current: unknown = record;
	for (const segment of path.split(".")) {
		if (typeof current !== "object" || current === null || Array.isArray(current)) return undefined;
		current = (current as Record<string, unknown>)[segment];
	}
	return current;
}

function firstString(record: RawRecord, paths: readonly string[] | undefined): string | undefined {
	for (const path of paths ?? []) {
		const value = readPath(record, path);
		if (typeof value === "string" && value.trim().length > 0) return value.trim();
	}
	return undefined;
}

function firstBoolean(record: RawRecord, paths: readonly string[] | undefined): boolean | undefined {
	for (const path of paths ?? []) {
		const value = readPath(record, path);
		if (typeof value === "boolean") return value;
	}
	return undefined;
}

function anyTrue(record: RawRecord, paths: readonly string[] | undefined): boolean {
	for (const path of paths ?? []) {
		if (readPath(record, path) === true) return true;
	}
	return false;
}

/** Accepts positive finite numbers only; `NaN`, `Infinity`, `0` are rejected. */
export function positiveFinite(value: unknown): number | undefined {
	return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : undefined;
}

export function firstPositive(record: RawRecord, paths: readonly string[] | undefined): number | undefined {
	for (const path of paths ?? []) {
		const value = positiveFinite(readPath(record, path));
		if (value !== undefined) return value;
	}
	return undefined;
}

function firstStringArray(record: RawRecord, paths: readonly string[] | undefined): string[] | undefined {
	for (const path of paths ?? []) {
		const value = readPath(record, path);
		if (Array.isArray(value)) {
			const items = value.filter((item): item is string => typeof item === "string");
			if (items.length > 0) return items;
		}
	}
	return undefined;
}

function availabilityOf(record: RawRecord, paths: readonly string[] | undefined): Availability | undefined {
	const value = firstString(record, paths);
	if (value === undefined) return undefined;
	const normalised = value.toLowerCase();
	if (normalised === "ok" || normalised === "active" || normalised === "available") return "ok";
	if (normalised === "offline" || normalised === "down" || normalised === "unavailable") return "offline";
	return "unknown";
}

/**
 * The shared read-side view of one catalog record.
 *
 * Strict `=== true` for every boolean: a provider that omits a capability gets
 * `false`, never an optimistic guess. Modalities are only added when the
 * provider declared them, so a wrong guess cannot silently enable image input.
 */
export interface CapabilityView {
	readonly name: string | undefined;
	readonly vision: boolean;
	readonly pdf: boolean;
	readonly audioInput: boolean;
	readonly videoInput: boolean;
	readonly imageOutput: boolean;
	readonly audioOutput: boolean;
	/** Tri-state: `undefined` when the provider did not send a boolean. */
	readonly tools: boolean | undefined;
	readonly reasoning: boolean;
	readonly contextWindow: number | undefined;
	readonly maxOutput: number | undefined;
	readonly thinkingFormat: string | undefined;
	readonly thinkingCanDisable: boolean | undefined;
	readonly availability: Availability | undefined;
	readonly declaredInput: string[] | undefined;
	readonly declaredEfforts: string[] | undefined;
}

export function capabilityView(record: RawRecord, fields: FieldAliases = {}): CapabilityView {
	return {
		name: firstString(record, fields.displayName),
		vision: anyTrue(record, fields.vision),
		pdf: anyTrue(record, fields.pdf),
		audioInput: anyTrue(record, fields.audioInput),
		videoInput: anyTrue(record, fields.videoInput),
		imageOutput: anyTrue(record, fields.imageOutput),
		audioOutput: anyTrue(record, fields.audioOutput),
		tools: firstBoolean(record, fields.tools),
		reasoning: anyTrue(record, fields.reasoning),
		contextWindow: firstPositive(record, fields.contextWindow),
		maxOutput: firstPositive(record, fields.maxOutput),
		thinkingFormat: firstString(record, fields.thinkingFormat),
		thinkingCanDisable: firstBoolean(record, fields.thinkingCanDisable),
		availability: availabilityOf(record, fields.availability),
		declaredInput: firstStringArray(record, fields.inputModalities),
		declaredEfforts: firstStringArray(record, fields.efforts),
	};
}

/** Projects the view into host-facing modality arrays. `file` maps to `pdf`. */
export function inputModalities(view: CapabilityView): Modality[] {
	const input = new Set<Modality>(["text"]);
	if (view.vision) input.add("image");
	if (view.pdf) input.add("pdf");
	if (view.audioInput) input.add("audio");
	if (view.videoInput) input.add("video");
	for (const modality of view.declaredInput ?? []) {
		const normalised = modality.toLowerCase();
		if (normalised === "image") input.add("image");
		else if (normalised === "audio") input.add("audio");
		else if (normalised === "video") input.add("video");
		else if (normalised === "file" || normalised === "pdf") input.add("pdf");
	}
	return [...input];
}

export function outputModalities(view: CapabilityView): OutputModality[] {
	const output = new Set<OutputModality>(["text"]);
	if (view.imageOutput) output.add("image");
	if (view.audioOutput) output.add("audio");
	return [...output];
}
