# Thinking formats and measured effort

Two separate questions, deliberately not merged:

1. **Format** — how does this provider spell "turn thinking on"? Declared in its
   catalog, mapped by `packages/contract/src/thinking.ts`.
2. **Effort** — which value actually buys more thinking on this exact route?
   Measured per model, never inferred.

## Format mapping

| Declared | Pi equivalent | Status |
|---|---|---|
| `openai` | `openai` | mapped |
| `deepseek` | `deepseek` | mapped |
| `qwen` | `qwen` | mapped |
| `zai` | `zai` | mapped |
| `kimi`, `gemini-level`, `minimax`, `step` | — | **unmapped** |

An unmapped format produces no effort menu. The model still reports thinking
content; the integration simply does not claim it can shape it. Adding an
override (`{ kimi: "openai" }`) requires a measurement entry below.

## Two kinds of effort menu

| Source | Meaning | Provenance |
|---|---|---|
| measured (`effort.ts`) | a probe compared levels on this route | `measured` |
| declared (models.dev `reasoning_options`) | the vendor publishes an effort enum | `models.dev` |

A declared menu maps each level to itself (that is the vendor enum), and it only
appears when the thinking format is one Pi can send. A measured value always wins.
Neither is a promise that the route honours a level: the measurement rule above
still decides when a claim is safe.

## Effort evidence

`packages/provider/src/effort.ts` holds only measured values, and every entry has
a line here with the date, the command, and the observed signal.

Format:

```
- YYYY-MM-DD `<provider>/<model>`: verdict `<verdict>`, wire `<value>`, signals {"low": 10, "max": 90}, noise floor 9.
```

## Verdicts

| Verdict | Meaning | Action |
|---|---|---|
| `mapped` | the highest level produced the largest signal | add the entry |
| `no-observable-difference` | signals within the noise floor | ship **no** menu |
| `inverted` | a lower level produced more thinking | map the level that buys depth, note the inversion |
| `unsupported` | every level rejected with 400/422 | no menu; record the rejection |
| `inconclusive` | a level failed for another reason (402, 429, 5xx, auth), or fewer than two levels were accepted | fix the account/quota and re-run; **never** record a verdict |

The noise floor defaults to `max(2, 10% of the largest signal)`. Reasoning-token
counts move by a few tokens on unrelated request noise, so an unbounded
comparison would "discover" a mapping in a 10-vs-11 sample.

## Client `max`

Pi's `max` level means "the highest effort this route actually applies", not a
promise to transmit the literal string `max`. That is why `effortMenu()` maps
only the highest level by default and hides the rest.

## Measured here

Nothing yet. This section fills up as providers are measured; see
`docs/EVIDENCE.md` for the log.
