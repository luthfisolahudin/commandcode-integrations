import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { toOpencodeModels } from "@luthfisolahudin/commandcode-integrations-opencode/model";
import { toPiModels } from "@luthfisolahudin/commandcode-integrations-pi/model";
import { buildModels } from "@luthfisolahudin/commandcode-integrations-catalog";
import type { RawRecord } from "@luthfisolahudin/commandcode-integrations-contract";
import { MEASURED_WIRE_EFFORT, measuredIds, packs } from "@luthfisolahudin/commandcode-integrations-provider";

const ROOT = join(import.meta.dirname, "../../..");
const FIXTURE = join(ROOT, "packages/provider/fixtures/catalog.json");

function records(): RawRecord[] {
	const payload = JSON.parse(readFileSync(FIXTURE, "utf8")) as { data?: RawRecord[] };
	assert.ok(Array.isArray(payload.data), "packages/provider/fixtures/catalog.json has no data[]");
	return payload.data;
}

/**
 * Host-agnostic contract: whatever pack this repo ships must project through
 * both adapters, with identical membership, and never crash on a real payload.
 * Tier-specific assertions live in `corpus.test.ts`, which `provider-init`
 * deletes along with `examples/`.
 */
for (const pack of packs) {
	test(`${pack.id}: both adapters project the fixture with identical membership`, () => {
		const models = buildModels(pack, records(), { measuredIds });
		assert.ok(models.length > 0, "no models projected");

		const host = {
			providerId: pack.id,
			baseUrl: pack.baseUrl,
			...(pack.thinkingFormatOverrides === undefined ? {} : { thinkingFormatOverrides: pack.thinkingFormatOverrides }),
		};
		const pi = toPiModels(models, MEASURED_WIRE_EFFORT, host);
		const opencode = toOpencodeModels(models, MEASURED_WIRE_EFFORT);

		const expected = models
			.filter((model) => model.excluded === undefined)
			.map((model) => model.id)
			.sort();
		assert.deepEqual(pi.map((model) => model.id).sort(), expected, `${pack.id} pi membership`);
		assert.deepEqual(opencode.map((model) => model.id).sort(), expected, `${pack.id} opencode membership`);

		for (const model of pi) {
			assert.equal(model.provider, pack.id);
			assert.equal(model.baseUrl, pack.baseUrl);
			// A provider may route each model to a different wire api, so assert that the
			// projection agrees with the model rather than that it is the default.
			const source = models.find((entry) => entry.id === model.id);
			assert.equal(model.api, source?.api ?? "openai-completions", `${model.id} api`);
			assert.ok(
				["openai-completions", "anthropic-messages", "openai-responses"].includes(model.api),
				`${model.id} api is one this adapter can drive`,
			);
			assert.ok(model.contextWindow > 0, `${model.id} context`);
			assert.ok(model.maxTokens > 0, `${model.id} maxTokens`);
			assert.ok(model.maxTokens <= model.contextWindow, `${model.id} output exceeds context`);
		}
	});

	test(`${pack.id}: an effort menu exists only where a measurement does`, () => {
		const models = buildModels(pack, records(), { measuredIds });
		const host = { providerId: pack.id, baseUrl: pack.baseUrl };
		const pi = new Map(toPiModels(models, MEASURED_WIRE_EFFORT, host).map((model) => [model.id, model]));
		const opencode = new Map(toOpencodeModels(models, MEASURED_WIRE_EFFORT).map((model) => [model.id, model]));

		for (const model of models) {
			if (model.excluded !== undefined || !model.reasoning) continue;
			const measured = MEASURED_WIRE_EFFORT[model.id];
			const piModel = pi.get(model.id);
			const opencodeModel = opencode.get(model.id);
			assert.ok(piModel, `${model.id} missing from pi`);
			assert.ok(opencodeModel, `${model.id} missing from opencode`);

			// A menu exists only when the host can send the format, and then either from a
			// measurement or from the provider's declared levels. Anything else stays closed.
			const mappable = piModel.compat?.thinkingFormat !== undefined;
			const declared = model.thinking.efforts;

			if (!mappable) {
				assert.equal(piModel.thinkingLevelMap, undefined, `${model.id} pi: unmapped format must offer no menu`);
				assert.equal(opencodeModel.capabilities.reasoning?.effort, undefined, `${model.id} opencode: unmapped format`);
				continue;
			}

			if (measured !== undefined) {
				assert.equal(piModel.thinkingLevelMap?.max, measured, `${model.id} pi menu value`);
				assert.deepEqual(opencodeModel.capabilities.reasoning?.effort, [measured], `${model.id} opencode effort`);
				continue;
			}

			if (declared !== undefined) {
				assert.ok(piModel.thinkingLevelMap !== undefined, `${model.id} pi: a declared menu should be exposed`);
				assert.ok((opencodeModel.capabilities.reasoning?.effort?.length ?? 0) > 0, `${model.id} opencode: declared menu`);
				continue;
			}

			assert.equal(piModel.thinkingLevelMap, undefined, `${model.id} pi must offer no menu`);
			assert.equal(opencodeModel.capabilities.reasoning?.effort, undefined, `${model.id} opencode must offer no menu`);
		}
	});

	test(`${pack.id}: no model claims image input the model cannot take`, () => {
		const models = buildModels(pack, records(), { measuredIds });
		for (const model of models) {
			// A pdf/audio/video declaration must not leak into Pi's text|image union.
			const projected = toPiModels([model], MEASURED_WIRE_EFFORT, { providerId: pack.id, baseUrl: pack.baseUrl });
			for (const entry of projected) {
				for (const modality of entry.input) assert.ok(modality === "text" || modality === "image");
			}
		}
	});
}
