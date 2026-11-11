# Adding a provider

Short version: `task init -- --id … --name … --base-url … --api-key-env …`.
The `add-provider` skill has the checklist an agent should follow; this document
explains the reasoning behind each step.

## Decide the tier first

The tier decides how much you have to curate, and pretending otherwise is how
integrations start lying:

| Tier | The catalog sends | What you must supply |
|---|---|---|
| A | limits, modalities, thinking hint | display names, evidence, effort |
| B | modalities, availability, price | limits (vendor docs), effort |
| C | ids only | everything you care about |

A Tier C provider is legitimate. What is not legitimate is a Tier C provider
whose picker shows 128 K context as if the vendor said so; provenance marks it
`default`.

## Where each fact goes

| Fact | Home | Why |
|---|---|---|
| endpoint, key env, `/models` path | `packages/provider/src/pack.ts` | vendor data |
| field aliases (`fields`) | `pack.ts` | vendor data |
| limits the catalog omits | `curated.ts` | curated, cited in `docs/EVIDENCE.md` |
| a price models.dev does not know | `curated.ts` (`cost`) | explicit USD, recorded as `curated` |
| a model models.dev lists under another id | `pack.ts` (`aliases`) | redirects the metadata lookup, not membership |
| display names | `curated.ts` / `names` | policy applied to vendor labels |
| membership floor | `fallback.ts` | so the provider is never empty |
| measured effort | `effort.ts` | a measurement, not a guess |
| ground truth | `invariants.ts` | independent of the catalog |

## Invariants

Assert facts the pack itself provides — the catalog fields or a `curated` entry.
A limit that only models.dev knows cannot be checked offline, so an invariant on
it would fail in CI for the wrong reason. `task check:catalog` verifies the projected model and `task check` runs it, so an
invariant is enforced on every push. An invariant naming a model that is currently
absent is reported, not failed.

## Fixtures

One sanitised `/models` payload per provider is enough. Refresh it deliberately:
a fixture is a test, and a test that always tracks upstream tests nothing.

## What "unknown" looks like

- no `vision` alias and no curated entry → `input: ["text"]`;
- no limit anywhere → `defaults` value, `provenance.limits.* = "default"`;
- no effort entry → no effort menu, `provenance.effort = "default"`.

All three are visible in `docs/PROVIDERS.md`, which is the point.
