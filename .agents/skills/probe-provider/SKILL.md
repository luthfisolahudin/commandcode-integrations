---
name: probe-provider
description: Measure how a provider responds to thinking/effort levels and record the evidence. Use when a reasoning model has no measured wire effort, when a new model id appears in the catalog, when a route starts rejecting reasoning_effort, or when thinking output looks identical across levels.
---

# Probe a provider's thinking behaviour

You are answering one question: **does this route actually change behaviour when
we ask for a different effort level?** A wrong answer ships a picker that offers
levels the route ignores, normalises, or inverts.

## Before you start

- Read `docs/THINKING.md` for the format table and the evidence format.
- Confirm the key exists in the environment named by the pack. Never print it.
- One model at a time. Aggregators fail over between upstreams within a single
  request, so parallel probes mix backends.

## Procedure

1. Run `task probe:effort -- --model <id> --levels minimal,low,medium,high,xhigh,max --samples 3`.
2. Read the verdict, not just the numbers:
   - `unsupported` — every level was rejected with 400/422. The model gets no effort menu.
   - `inconclusive` — a level failed for another reason (402, 429, 5xx, auth)
     or fewer than two levels were accepted. Fix the account and re-run; do not
     record a verdict, and never read it as "no difference".
   - `no-observable-difference` — the signals are within the noise floor. Ship
     **no** menu. This is the common case and it is a correct outcome.
   - `mapped` — the highest level produced the largest signal. Record it.
   - `inverted` — a lower level produced more thinking than a higher one. Record
     the level that actually buys depth, and note the inversion.
3. Append exactly one line to `docs/EVIDENCE.md`: date, model, command, verdict,
   the per-level signals, and the noise floor.
4. Only for `mapped` or `inverted`, add the id to
   `packages/provider/src/effort.ts`.
5. Run `task check:catalog` and `task check`.

## Never

- Never add an effort entry because a model "looks like" it supports a level.
- Never re-run until the numbers agree with a guess. Three samples, then decide.
- Never treat a `429` or `5xx` as a capability answer; it is a quota or outage.
- Never probe a second model in the same run to "save time".

## When the format is unmapped

A declared format such as `kimi`, `gemini-level`, `minimax`, or `step` has no Pi
equivalent. A measurement can still justify an override in
`packages/provider/src/pack.ts` — record it in `docs/THINKING.md` with the date
and the evidence line, or leave the model without an effort menu.
