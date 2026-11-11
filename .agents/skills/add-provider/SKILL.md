---
name: add-provider
description: Turn this template into a provider repo, or add a second endpoint to an existing one. Use when onboarding a new vendor, when asked to support a new OpenAI-compatible endpoint, or when the repo still ships the example pack.
---

# Add a provider

## 1. Scaffold

```sh
task init -- --id <id> --name "<Name>" --base-url <url> --api-key-env <ENV> --tier a|b|c
```

Drop the `--yes` that `task init` prints only after reading the dry-run plan: it
deletes `examples/` and rewrites the root package.

Pick the tier by what the catalog actually declares, not by what you wish it did:

- **a** — the provider sends limits, modalities and a thinking hint;
- **b** — the provider sends modalities/availability but no limits;
- **c** — the provider sends ids only.

## 2. Capture the catalog

Save one real `/models` response into `packages/provider/fixtures/catalog.json`,
with keys and account identifiers removed. The fixture is the test surface; a
live call is only for refreshing it.

## 3. Declare where the facts live

Edit `packages/provider/src/pack.ts` `fields`: dotted paths into the record, most
specific first. If the provider needs a request the declarative path cannot
express, use `hooks.discover` — never put a `fetch` in this package.

## 4. Curate what the catalog cannot express

- limits the vendor documents: `packages/provider/src/curated.ts`;
- display names its slug cannot render: `curated` or the `names` map;
- anything you cannot verify: leave it out. A `default` provenance is honest.

## 5. Write invariants

Add vendor-documented facts to `packages/provider/src/invariants.ts`. These are
the independent source of truth; they must not simply restate the fixture.

## 6. Wire and verify

- install paths: `adapters/pi/src/index.ts` and `adapters/opencode/src/index.ts`;
- `task check:catalog` must show the expected membership and provenance;
- `task probe:effort` for every reasoning model you intend to offer effort on;
- `task report --write`, then `task check`.

## 7. Document

Fill `docs/REPO.md` with the vendor's quirks: TLS oddities, status semantics,
price currency, retention. Anything a future reader would otherwise rediscover.
