# Auditing a provider catalog

A catalog is a vendor's claim about its own routes. Two things routinely go wrong:
the claim is incomplete, or a third party's claim about the same model is mistaken
for the vendor's. This procedure decides, per capability, whether the catalog is
right, wrong, or silent — and what a pack may therefore say.

Use it when a model looks wrong in a picker, when a vendor adds models, or before
promoting a hint-sourced value to a curated one.

## The three witnesses

Every capability needs one of these, in this order of authority.

| Witness | What it is | What it may decide |
|---|---|---|
| The vendor's own API docs or model page | The lab that makes the model: Moonshot, MiniMax, NVIDIA, Tencent | `curated` facts, invariants |
| The vendor's `/models` catalog | What this gateway declares per id | `catalog` facts |
| models.dev | A vote across every gateway publishing that id | limits, cost, modalities — never a capability this repo ships |

A models.dev entry is not one claim. `reasoning_options` is chosen by majority
across all publishers, so one reseller that maps `high` to a budget can outvote the
lab. When you need to know where a value came from, count who declares it:

```sh
node --input-type=module -e '
const catalog = await (await fetch("https://models.dev/api.json")).json();
const key = (id) => String(id).trim().toLowerCase()
  .replace(/:[a-z0-9._-]+$/u, "")
  .replace(/[@-]\d{4}-?\d{2}-?\d{2}$/u, "")
  .split("/").pop();
// Under `-e`, argv[1] is the first user argument. Normalise it before comparing: an
// uppercase id otherwise matches nothing and prints an empty result.
const target = key(process.argv[1]);
const claim = (m) => {
  if (m.reasoning !== true) return "non-reasoning";
  const ro = m.reasoning_options ?? [];
  const effort = ro.find((o) => o.type === "effort")?.values;
  if (Array.isArray(effort) && effort.length) return effort.join(",");
  if (ro.some((o) => o.type === "budget_tokens")) return "budget_tokens";
  return ro.some((o) => o.type === "toggle") ? "toggle-only" : "reasoning, no control";
};
// Deduplicate per publisher: one gateway listing four spellings of a model is one
// vote, not four.
const byPublisher = new Map();
for (const [provider, entry] of Object.entries(catalog))
  for (const [id, model] of Object.entries(entry.models ?? {})) {
    if (key(id) !== target) continue;
    byPublisher.set(provider, new Set([...(byPublisher.get(provider) ?? []), claim(model)]));
  }
if (byPublisher.size === 0) { console.error(`no publisher lists "${target}"`); process.exit(1); }
const votes = new Map();
for (const [provider, claims] of byPublisher)
  votes.set([...claims].sort().join(" + "), [...(votes.get([...claims].sort().join(" + ")) ?? []), provider]);
console.log(`${target}: ${byPublisher.size} publisher(s)`);
for (const [label, providers] of [...votes].sort((a, b) => b[1].length - a[1].length))
  console.log(String(providers.length).padStart(4), label.padEnd(44), providers.slice(0, 6).join(" "));
' <model-id>
```

A publisher is first-party when it makes the model; test that per model rather than
from a list, because the same publisher name can be a lab for its own models and a
reseller for others. `tencent-tokenhub` is first-party for `hy3`/`hy4` and a
reseller for the Kimi and GLM ids it also lists; `nvidia` is first-party for
`nemotron-*` and a reseller for the DeepSeek and Kimi ids in its catalog. Plans of a
lab (`*-coding-plan`, `*-token-plan`, `*-cn`) are the same lab counted again. If
only resellers declare a ladder, treat it as that reseller's route, not the model's.

## Deciding thinking support

Thinking is two questions, and a catalog usually answers neither.

1. **Is there an on/off switch?** The labs overwhelmingly spell this
   `thinking: {type: "enabled"|"disabled"}` or a bare toggle. A missing level is
   not a missing capability: `reasoning_effort: "none"` frequently disables
   thinking even when the catalog enum omits `none`.
2. **Is there a ladder?** Only a measurement answers this. A declared enum is a
   declaration that the values are accepted, not that they differ in depth.

A model that reasons with no ladder still deserves an **off** entry. A model whose
off switch is rejected (Moonshot returns an error for `disabled`, MiniMax-M3.1-Flash
returns 400) deserves **no** menu at all — an on-only model has nothing to choose.

## Measuring, not reading

Acceptance is not behaviour. Send each level a task that demands depth, with a
**unique prompt per call**, and compare `usage.reasoning_tokens` (fall back to
`reasoning_content` length when the route omits the count):

- `max_tokens: 12000`, 3 samples per level, interleaved and shuffled.
- Include `default` (parameter omitted) and `none` as separate conditions.
- Run a **control**: a model already believed to have a ladder. If the control
  shows no slope, the probe cannot resolve a slope anywhere and the run is void.
- The noise floor is `max(2, 10% of the largest signal)`. Below it, report
  `no-observable-difference`; do not call it a ladder.

A response that returns byte-identical reasoning for the same prompt is serving a
cache, not measuring effort.

## What each outcome may become

| Observation | Menu |
|---|---|
| Ladder: highest level produces the largest signal | measured entry, highest level only |
| Off switch zeroes reasoning, all other levels equal | `curated: ["none", "high"]` with `thinkingCanDisable` |
| Off switch rejected, or `none` does not disable | no menu |
| Every level equal, no off switch | no menu |
| `400`/`422` for every level | no menu; record the rejection |
| `402`, `429`, `5xx`, fewer than two levels accepted | inconclusive; fix the account and re-run |

Facts you cannot attribute to a witness stay unknown. Unknown is a supported state
in this repo: the model is registered, it reports thinking content, and the
integration does not claim to shape it.

## Record it

Every promoted fact needs a placed line in `docs/EVIDENCE.md`: the date, the
witness (vendor doc URL or the probe command), and what was observed. A curated
enum without an evidence line is a guess with extra steps.

## Vendor quirks worth checking first

These recur across gateways and are cheap to rule out.

- The gateway may drop a parameter the vendor honours, or honour one the vendor
  spells differently (`chat_template_kwargs`, `reasoning_budget`, `thinking`).
- A model page that lists a parameter as `--` or "Not supported" is authoritative
  over any reseller that advertises it.
- An aggregator fails over between upstreams per request, so identical requests can
  land on different backends. Probe one model at a time and never conclude from a
  single sample.
