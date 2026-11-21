# Update the copied engine

Fetch the desired tag in a checkout of the upstream engine, then run this from the provider repo:

```sh
pnpm run engine:update --source <upstream-checkout> --tag <version>
pnpm run check:catalog
git diff -- engine engine.lock.json
```

The updater verifies the current copy against its digest, stages the selected tag, and checks that it accepts the same pack schema. It switches to the staged copy and runs the provider repo's `pnpm check`. A failed check restores the previous engine and lock. Keep upstream engine changes in the upstream repo so each copy stays verifiable.

Commit `engine/` and `engine.lock.json` together. To roll back, revert that commit and run `pnpm check`.

For an existing merge-based consumer, generate a sibling checkout and bring over the pack, provider fixtures, and evidence. Use the generated entrypoints to verify the new engine, then apply the equivalent file changes to the existing repo. Preserve model IDs and the provider's Git history.
