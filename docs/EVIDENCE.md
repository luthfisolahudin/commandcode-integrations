# Evidence log — Command Code

## Catalog shape (2026-11-11)

Two views, merged by model id:

| View | Endpoint | Authoritative for |
|---|---|---|
| Client catalog | `GET /models?view=client` | label, context, output cap, modalities, `reasoningEfforts`, pricing, `minimumPlan`, `hidden` |
| Public list | `GET /models` | `supported_endpoints`, which decides the wire protocol |

- Client catalog: `schemaVersion: 1`, `catalogVersion` (a commit-like hash),
  `refreshAfterSeconds: 900`, 113 entries before filtering.
- Public list: 97 models.
- Merged fixture: **97 models** — 12 `anthropic-messages`, 85 `openai-completions`,
  0 `openai-responses`.
- `reasoningEfforts` values present: `off` 6, `low` 66, `medium` 57, `high` 65,
  `xhigh` 40, `max` 35. **26 models declare no effort** — they get no menu.
- Hidden entries are dropped at merge time; `minimumPlan` is kept for reference but
  does not route (a plan-gated model answers 403, which is not a routing failure).

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

## Effort values are per route

`/chat/completions` accepts `off`, `low`, `medium`, `high`, `xhigh`, `max`.
`/responses` uses `none`, `minimal`, … instead of `off`. Anthropic Messages uses a
thinking object with an effort field. The pack therefore advertises the catalog's
levels unchanged, and the adapter drops the menu when the format is not mappable
(see `docs/THINKING.md`).

## Curated facts

- None. Everything asserted here comes from the catalog or from the endpoint probes
  above; inventing a per-model invariant would only restate the client catalog.

## User agent

Cloudflare sits in front of the API and answers `403 error code: 1010` to Python's
default user agent. The pack sends `commandcode-integrations/0.1` on every request,
including the two catalog views.
