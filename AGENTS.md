# ai-provider-integrations-template

A template repo for OpenAI Chat Completions provider integrations with live
model discovery for Pi and OpenCode. Membership comes from the provider's
`/models`; nothing is typed by hand.

## What this repo is

A pnpm workspace with role-separated packages: the engine is generic, the vendor
lives in exactly one package, and two adapters translate normalised models into
each harness's API. The template ships three example packs covering three real
catalog qualities:

- `packages/provider` — the starter (Tier A: the catalog describes itself);
- `examples/tier-b` — modalities, availability and price only (Tier B);
- `examples/tier-c` — ids and nothing else (Tier C).

`provider-init` turns this checkout into a single-provider repo and deletes the
corpus.

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
| policy | vendor-neutral rules and contracts | `packages/contract` |
| mechanics | I/O that applies policy to facts | `packages/catalog` |
| adapters | translation into a host API | `adapters/pi`, `adapters/opencode` |

Import rules, enforced by `workspace:*` deps and `task check:boundaries`:

- `packages/contract` imports nothing from this repo.
- `packages/catalog` may not import a provider.
- `packages/provider` may not import a catalog or an adapter.
- an adapter may not import another adapter.
- `packages/cli` may not import an adapter.
- `packages/conformance` may import everything, and is the only package that does.
- Import across packages by package name (`<scope>/<repo>-<suffix>`), never by
  relative path. `task init` renames the prefix, and relative paths silently
  survive the rename.

## Commands

```sh
task check            # typecheck + unit tests + boundaries + doctor
task check:catalog    # project the fixture/live catalog, assert invariants
task probe:effort     # measure thinking/effort for one model (needs an API key)
task probe:routes     # which wire routes the endpoint exposes
task report --write   # regenerate docs/PROVIDERS.md
task doctor           # symlink pair, AGENTS.md, skills, vendor shape
task pricing          # T3 Code price block: print, --check, or --write
task sync:template    # merge a template tag (downstream repos only)
task init             # turn this checkout into a provider repo
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

Ask before: bumping `PACK_SCHEMA_VERSION`, merging a template tag, deleting a
fallback id, choosing an effort mapping when the probe is inconclusive, or
turning a `default` provenance into a `curated` one.

## Vendor notes

Vendor-specific quirks, quirks of the API and undocumented behaviour live in
`docs/REPO.md`.
