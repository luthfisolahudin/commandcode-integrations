# Evidence log — Command Code

## Catalog shape (2026-11-24)

Two views, merged by model id:

| View | Endpoint | Authoritative for |
|---|---|---|
| Client catalog | `GET /models?view=client` | label, context, output cap, modalities, `reasoningEfforts`, pricing, `minimumPlan`, `hidden`, `zdr` |
| Public list | `GET /models` | `supported_endpoints`, which decides the wire protocol |

- Client catalog: `schemaVersion: 1`, `catalogVersion` (a commit-like hash),
  `refreshAfterSeconds: 900`, 122 entries before filtering.
- Public list: 105 models.
- Merged fixture: **105 models** — 12 `anthropic-messages`, 93 `openai-completions`,
  0 `openai-responses`. The two views currently agree on membership in both
  directions: no public-only and no client-only ids.
- `reasoningEfforts` values present: `off` 9, `low` 72, `medium` 62, `high` 72,
  `xhigh` 44, `max` 38. **27 models declare no effort** — they get no menu.
- Hidden entries are dropped at merge time; `minimumPlan` is kept for reference but
  does not route (a plan-gated model answers 403, which is not a routing failure).
- Re-captured on 2026-11-24 from 113 → 122 client entries: 1 new hidden model
  (`thinkingmachines/inkling-2-small:free`), 8 new visible models, 0 removed, and
  0 changes to any shared model's effort levels, context window or price.

## Routing

Chat-first, and the reason it is chat-first rather than vendor-first:

- Claude by group or id → Anthropic Messages, because that is how adaptive thinking
  and effort are expressed.
- Everything else prefers `/chat/completions`: 72 models listed both routes and all
  of them answered Chat, while `/responses` failed for some of them.
- `/responses` is chosen only when a model lists it and nothing else. No visible
  model does today; the branch stays for the day one does.

Endpoint probe over the 72 models that list `/responses` (from the previous
implementation, still representative):

- 47 returned 200, 17 returned 403 (plan access), 8 failed on both routes for
  upstream reasons.
- `Qwen/Qwen3.6-Plus` returned 400 on `/responses` but 200 on `/chat/completions`.

## Zero data retention

`zdr` is a per-model boolean in the client view: `true` means the model has a
ZDR-capable upstream, `false` means it has none. The wire signal is the
`x-cmd-zdr: 1` request header (the CLI sets it from `CMD_ZDR=1`), and it is
fail-closed: no ZDR upstream means `422 cmd_zdr_no_providers`, never a silent
fallback. The public list does not carry the field, so a public-only model is
`unknown`, not `false` — `mergeCatalog` leaves the key absent for it.

- 2026-11-24: 90 of 105 visible models are ZDR-capable; 15 are not.
  The merge forwards the flag unchanged and keeps it absent when unstated.
- Probed all 105 visible models with `x-cmd-zdr: 1` on their routed endpoint.
  Of the 15 models declaring `zdr: false`, 13 answered `422 cmd_zdr_no_providers`,
  `sakana/fugu-ultra` answered `403` (plan-gated, so not a ZDR verdict), and
  `MiniMaxAI/MiniMax-M3` answered `200` — see the mismatch below.
- One reverse mismatch: `MiniMaxAI/MiniMax-M3` is declared `zdr: false` yet
  answered a ZDR request `200` on 7/7 attempts. The catalog is conservative here,
  which is the safe direction; do not treat `false` as a hard refusal.
- `claude-fable-5`, `5-1` and `5-2` answer a different 422: "Anthropic keeps this
  model's prompts for 30 days". That is permanent, not a monthly capacity renewal,
  so these ids are pinned as non-ZDR in `packages/provider/test/catalog.test.ts`.
- ZDR is not only routing. `/responses` refuses built-in tools under the header
  (`422 cmd_zdr_unsupported_tool`), and the CLI repoints its `zdrFeatures` roles
  (vision → `deepseek/deepseek-v4.1-flash`), pauses saved feature models with no
  ZDR route, and disables the free-model background-task path. Prompt caching is
  unaffected: a 4.4k-token prefix returned `cached_tokens: 4352` with the header
  set and without it.
- Two models flipped `zdr: false → true` since the previous capture:
  `z-ai/glm-5.3-flashx` and `tencent/hy4-preview`. The flag follows monthly
  provider agreements, so it moves without a model change.

## Effort values are per route

`/chat/completions` accepts `off`, `low`, `medium`, `high`, `xhigh`, `max`.
`/responses` uses `none`, `minimal`, … instead of `off`. Anthropic Messages uses a
thinking object with an effort field. The pack therefore advertises the catalog's
levels unchanged, and the adapter drops the menu when the format is not mappable
(see `docs/THINKING.md`).

`minimal` is not in CommandCode's enum at all: `task probe:effort` on
`deepseek/deepseek-v4.1-flash` answered `400` for `minimal` while `off`, `low`,
`medium`, `high`, `xhigh` and `max` all answered `200`. The CLI's own validator
agrees — its effort set is `{off, low, medium, high, xhigh, max}`.

- 2026-11-24 `commandcode/deepseek/deepseek-v4.1-flash`: verdict
  `no-observable-difference`, signals `{"low": 11, "medium": 12, "high": 11,
  "xhigh": 11, "max": 10}`, noise floor 2, three samples per level. The route
  *accepts* undeclared `medium` and `xhigh` even though the catalog omits them, so
  the missing menu entries are the vendor's declaration, not a wire limit. No
  measured entry was added: a 1-token spread across five levels is noise, and
  `docs/THINKING.md` forbids recording a mapping from one.

## Curated facts

- None. Everything asserted here comes from the catalog or from the endpoint probes
  above; inventing a per-model invariant would only restate the client catalog.

## User agent

Cloudflare sits in front of the API and answers `403 error code: 1010` to Python's
default user agent. The pack sends `commandcode-integrations/0.1` on every request,
including the two catalog views.

- 2026-11-21: engine v2.0.0 streamed chat in Pi 1.5.2 and OpenCode 2.3.2 with `stealth/glyph-cluster:free`. The live client catalog confirmed zero input and output token rates.

## Pricing unit

The client catalog's `pricing.*Cost` fields are **USD per 1M tokens**, not per
token. The hosts also want per 1M, so `normalizePricing` passes the numbers through
unchanged; any multiplication is a 1,000,000x error.

- 2026-11-21: `https://commandcode.ai/docs/plans/goat` states "Rates are per 1M
  tokens" and lists Claude Sonnet 5.5 at `$2.00 / $10.00 / $0.10 / $2.50` and
  Claude Haiku 5.5 at `$0.10 / $0.50 / $0.01 / $0.125`. `packages/provider/fixtures/client-catalog.json`
  reports exactly those four numbers for both models, so the capture and the
  published table agree on the unit.
- Consequence found and fixed: the earlier `perMillion()` helper multiplied by
  `1_000_000`, so the committed `fixtures/catalog.json` carried `input: 3000000`
  for a `$3` model. `packages/provider/test/catalog.test.ts` now pins three rows
  against the vendor table, so the unit cannot silently drift again.

## Off-peak and peak rates

The catalog publishes **off-peak** rates. DeepSeek models move to roughly double
for 7 hours a day: `https://commandcode.ai/docs/resources/pricing-limits` shows
DeepSeek V4.1 Flash at `$0.15 / $0.60` off-peak and `$0.30 / $1.20` during
01–04 and 06–10 UTC, Mon–Fri, and the page labels every other number as the
off-peak one. V4.1 Flash Fast goes `$0.16 / $0.58` → `$0.32 / $1.16`.

Nothing in the catalog marks the peak rate or the window, so the pack cannot
carry it: the projected cost is the off-peak rate and T3 Code usage estimates
understate a peak-hour request by that factor. Treat the catalog number as a
floor, not a bill.
