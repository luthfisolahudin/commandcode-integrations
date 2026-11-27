---
name: audit-catalog
description: >
  Verify that a provider integration's model list, capabilities and thinking
  options match what the vendor actually serves, separating the vendor's own
  claim from third-party hints. Load when a model looks wrong or missing in a
  picker, when thinking/effort options are absent or suspicious, when a new model
  id appears, or before promoting a hint-sourced value to a curated fact.
---

# Audit a provider catalog

**Answer one question per capability: did the vendor say this, or did someone else say it about the vendor?**

## When to use

Activated by: "model missing", "no thinking options", "catalog looks wrong", a
new model id, or a curation decision. Not for measuring one effort level end to
end — that is [probe-provider](../probe-provider/SKILL.md) — and not for adding a
provider, which is [add-provider](../add-provider/SKILL.md).

## The rule

Three witnesses, in this order: the vendor's API docs, the vendor's `/models`
catalog, then models.dev. A lower witness never overrides a higher one, and
models.dev may only fill what the catalog is silent about (limits, cost,
modalities) — it never decides a capability this repo ships.

The reason is mechanical: models.dev picks `reasoning_options` by majority across
every gateway publishing that id, so resellers outvote the lab. A five-level ladder
attributed to a model whose lab offers only on/off is that reseller's route.

## Workflow

1. **Collect.** Read the fixture (`packages/provider/fixtures/catalog.json`), the
   live `task check:catalog`, and the projection from `task report`. Diff live
   against fixture; a stale fixture hides new and resurrected models.
2. **Attribute.** For each disputed model, run the vote script in
   [docs/AUDITING.md](../../../docs/AUDITING.md) and separate first-party labs from
   resellers. Any ladder declared only by resellers is not evidence.
3. **Read the lab.** Fetch the vendor model page or API reference. Look for
   `reasoning_effort`, `thinking`, `reasoning_budget`, `chat_template_kwargs`. A
   page saying "Not supported" or `--` beats any catalog entry.
4. **Measure.** Acceptance is not behaviour: send a level and check
   `usage.reasoning_tokens`. Off switch works? Ladder separates? Run a control, or
   the run proves nothing.
5. **Decide**, using the outcome table in
   [docs/AUDITING.md](../../../docs/AUDITING.md#what-each-outcome-may-become).
   Off switch only becomes `curated: ["none", "high"]`; a ladder becomes a measured
   entry; nothing provable becomes no menu.
6. **Record** one dated line in `docs/EVIDENCE.md` naming the witness. Then
   `task check:catalog` and `task check`.

## Never

- Never let a hint, a model name, or a reseller's enum create a menu.
- Never read `402`/`429`/`5xx` as a capability answer; they are quota or outage. A
  `4xx` on **every** level is `unsupported`, but one rejected level is a finding
  about that level, not about the model.
- Never treat "the API accepted `NONSENSE`" as support; these gateways rarely
  validate, so acceptance says nothing about depth.
- Never cite a model page you did not open, or a probe you did not run.

## Done means

Every disputed model has a verdict backed by a named witness, the fixture matches
the live catalog or the difference is explained, `task check` passes, and
`docs/EVIDENCE.md` carries a dated line per changed fact.

## Reference index

| Topic | Reference | Load when |
|---|---|---|
| Attribution script, outcome table, vendor quirks | `docs/AUDITING.md` | running an audit |
| Format map, effort verdicts, noise floor | `docs/THINKING.md` | deciding a menu |
| Vendor-specific quirks | `docs/REPO.md` | a route behaves unexpectedly |

**Related:** [probe-provider](../probe-provider/SKILL.md), [add-provider](../add-provider/SKILL.md), `docs/AUDITING.md`.
