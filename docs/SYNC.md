# Update the copied engine

Fetch the desired tag in a checkout of the upstream engine, then run this from the provider repo:

```sh
pnpm run engine:update --source <upstream-checkout> --tag <version>
git diff -- engine engine.lock.json packages/cli packages/conformance
```

## What the updater guarantees

`engine.lock.json` lists every file the release owns with its sha256. That covers
more than `engine/`:

| Tree | Owned by the release |
|---|---|
| `engine/` | yes — contract, catalog, and both adapter factories |
| `packages/cli/src`, `packages/cli/test` | yes |
| `packages/contract/test`, `packages/catalog/test` | yes |
| `packages/conformance/test` | yes, except `corpus.test.ts`, which needs the example packs |
| `scripts/engine.ts` | yes — the updater ships itself |

`pnpm check` runs `scripts/engine.ts verify` first, so editing any of those files
fails the gate. That is deliberate: a checkout whose CLI or tests have quietly
diverged from its tag is a fork that claims to be a pin.

Changed files outside that list are yours. They are staged and restored across a
failed update together with the engine itself.

## Sequence

The updater:

1. verifies the current copy against its manifest;
2. stages the selected tag and refuses a different `PACK_SCHEMA_VERSION`;
3. snapshots every owned path, then writes the staged tree;
4. runs this repo's `pnpm check`;
5. restores the previous tree and lock if that check fails.

## Committing and rolling back

Commit `engine/`, `engine.lock.json`, and any managed file the release changed, in
one commit. To roll back, revert that commit and run `pnpm check`.

## Upgrading from a pre-manifest lock

A lock written before v2.1.0 stores one directory `digest` and no `files`. It
cannot be verified against a manifest, so the first update out of one replaces the
tree outright and says so:

```
engine: replacing a pre-manifest lock; run `git diff` and commit the result
```

It still runs `pnpm check` and still restores the old lock on failure. Review the
diff; nothing else about the procedure changes.

## Adopting an existing merge-based consumer

Generate a sibling checkout, bring over the pack, provider fixtures, and evidence,
and verify the new engine through the generated entrypoints before applying the
equivalent changes to the existing repo. Preserve model IDs and the provider's Git
history.

## v2.1.x notes

- v2.1.0 replaces the single directory digest with the per-file manifest above and
  adds `cli`, `conformance`, and the engine tests to it.
- v2.1.1 makes `docs/PROVIDERS.md` reproducible: `report` no longer reads the
  machine-local models.dev cache unless `--hints` is passed, so `report --check`
  gives the same answer on your machine and in CI.
