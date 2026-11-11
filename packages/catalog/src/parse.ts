import type { RawRecord } from "@luthfisolahudin/commandcode-integrations-contract";

function isRecord(value: unknown): value is RawRecord {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Validates a `/models` response without changing its membership.
 *
 * Accepts `{data: []}`, `{models: []}`, `[]`, and a single record. Everything
 * else throws: a catalog we cannot read is a configuration error, not an empty
 * provider. Duplicate ids also throw, because a picker keyed by id would hide
 * one of them and the next refresh would look like a random model swap.
 */
export function parseEnvelope(payload: unknown): RawRecord[] {
	const entries: unknown[] = [];
	if (Array.isArray(payload)) {
		entries.push(...payload);
	} else if (isRecord(payload)) {
		const data = payload.data;
		const models = payload.models;
		if (Array.isArray(data)) entries.push(...data);
		else if (Array.isArray(models)) entries.push(...models);
		else if (typeof payload.id === "string") entries.push(payload);
	}
	if (entries.length === 0) {
		throw new Error("model discovery returned an invalid catalog (no model records)");
	}

	const seen = new Set<string>();
	const records: RawRecord[] = [];
	for (const entry of entries) {
		if (!isRecord(entry)) throw new Error("model catalog contains a non-object record");
		const id = entry.id;
		if (typeof id !== "string" || id.trim().length === 0) {
			throw new Error("model catalog contains a record without a usable id");
		}
		if (seen.has(id)) throw new Error(`model catalog contains a duplicate id: ${id}`);
		seen.add(id);
		records.push({ ...entry, id });
	}
	return records;
}
