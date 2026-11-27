# commandcode-integrations

## What this repo is

A provider checkout for **Command Code** (`https://api.commandcode.ai/provider/v1`),
shared by Pi and OpenCode.

Two catalog views are merged by id: `GET /models?view=client` (the authoritative
one for facts) and `GET /models` (`supported_endpoints`, the only source of wire
protocol truth). Prices in the client catalog are **USD per 1M tokens**, which is
already the unit the hosts want.

The client catalog declares context, modalities, efforts and per-1M prices; the public list declares endpoints.

## Read first

- `docs/DESIGN.md` — why membership, metadata and behaviour are three questions.
- `docs/STRUCTURE.md` — the package cut and the import matrix.
- `docs/SYNC.md` — how a provider repo takes template updates.
- `docs/ADDING-A-PROVIDER.md` — the long form of the `add-provider` skill.
- `docs/THINKING.md` — declared formats, measured efforts, and the evidence rule.
- `docs/EVIDENCE.md` — this repo's probe log.

## Packages and layers

Four words decide where a line of code goes:

| Word | Meaning | Package |
|---|---|---|
| facts | vendor data and measurements | `packages/provider` |
| policy | vendor-neutral rules and contracts | `packages/runtime/contract` |
| mechanics | I/O that applies policy to facts | `packages/runtime/catalog` |
| adapters | host wiring (thin) | `adapters/pi`, `adapters/opencode` |
| factories | reusable host adapters | `packages/runtime/pi`, `packages/runtime/opencode` |
| factories | reusable host adapters | `packages/runtime/pi`, `packages/runtime/opencode` |

Import rules, enforced by `workspace:*` deps and `task check:boundaries`:

- `packages/runtime/contract` imports nothing from this repo.
- `packages/runtime/catalog` may not import a provider.
- `packages/provider` may not import a catalog or an adapter.
- an adapter may not import another adapter.
- `packages/dev/cli` may not import a factory or an adapter.
- `packages/dev/conformance` may import everything, and is the only package that does.
- Import across packages by package name, never by relative path. Package
  names follow one grammar: `@luthfisolahudin/<project>-integrations-<role>`. The
  head token names the owner (`ai-integrations` upstream, `commandcode` here), so
  `ai-integrations-pi` is the factory and `commandcode-integrations-pi` is wiring.
- A package that needs the vendor imports it through `#provider`, an alias each
  consumer package maps to `src/provider.ts`, which re-exports
  `../../../provider/src/index.ts`. The alias is structural: only the packages
  allowed to see the vendor declare it.
- A package that needs the vendor imports it through `#provider`, an alias each
  consumer package maps to `src/provider.ts`, which re-exports
  `../../../provider/src/index.ts`. The alias is structural: only the packages
  allowed to see the vendor declare it.

`packages/runtime/**` and `packages/dev/**` are release-owned, copied from
`ai-integrations`. `ai-integrations.lock.json` lists each of those files with
its sha256, so editing one is a lock violation, not a quiet fork. Change them
upstream and take a new tag; see `docs/SYNC.md`.

## Commands

```sh
task check            # engine verify + typecheck + tests + boundaries + catalog + report + doctor
task check:catalog    # project the fixture/live catalog, assert invariants
task probe:effort     # measure thinking/effort for one model (needs an API key)
task probe:routes     # which wire routes the endpoint exposes
task report --write   # regenerate docs/PROVIDERS.md
task capture          # re-capture the catalog fixtures from the live API (needs a key)
task sync:upstream    # copy packages/runtime + packages/dev from a tagged release
task sync:cli-version # rewrite the Command Code CLI version from npm (--check for drift)
task doctor           # symlink pair, AGENTS.md, skills, vendor shape
task pricing          # T3 Code price block: print, --check, or --write
```

## Hard invariants

1. **Never invent a capability.** Unknown stays unknown; a guessed `vision` or
   `contextWindow` shows up as `default` provenance and is reviewed in a diff.
2. **Never invent an effort.** A model gets an effort menu only when
   `packages/provider/src/effort.ts` has a measured entry backed by
   `docs/EVIDENCE.md`. Unmeasured means no menu, not a plausible default.
3. **Never derive reasoning or vision from a regex on the model id.**
4. **Membership is discovered.** A pack may pin a small fallback so a provider is
   never registered empty, and nothing else.
5. **`packages/provider` is the only vendor surface.** No vendor URL, header, or
   model id belongs anywhere else.
6. **Generated files are not edited.** `docs/PROVIDERS.md` is output.
7. **No credentials in the repo.** Keys come from the environment named in the
   pack; fixtures are sanitised payloads.
8. **`packages/contract`'s public surface changes only with a
   `PACK_SCHEMA_VERSION` bump**, plus a migration note in `docs/SYNC.md`.

## Change protocol

Fixture first, then invariants, then the projection test, then the code:

1. capture a real payload into `packages/provider/fixtures/`;
2. declare where the facts live in `packages/provider/src/pack.ts`;
3. write the invariant from the vendor's docs, not from the catalog;
4. run `task check:catalog`, then `task probe:effort` if the model reasons;
5. append an evidence line with the date, the command, and the observed signal;
6. run `task check` before claiming the change is done.

## Human decisions

Ask before: bumping `PACK_SCHEMA_VERSION`, deleting a
fallback id, choosing an effort mapping when the probe is inconclusive, or
turning a `default` provenance into a `curated` one.

## Vendor notes

`docs/REPO.md` records Command Code's quirks; `docs/EVIDENCE.md` holds the endpoint and pricing-unit evidence.
