---
name: update-engine
description: Update a provider checkout to a newer tagged engine release, verifying the file manifest before and after.
---

# Update the engine

Follow [the update procedure](../../../docs/SYNC.md).

1. Check the current pin: `task check` runs `scripts/engine.ts verify` first.
2. Update: `pnpm run engine:update --source <upstream-checkout> --tag <version>`.
3. Review `git diff -- engine engine.lock.json packages/cli packages/conformance` together.
   `engine.lock.json` lists every file the release owns with its sha256, so an
   edit to the CLI, the conformance suite, or the engine's own tests is a lock
   violation rather than silent drift.
4. Commit `engine/`, `engine.lock.json`, and the managed files in one commit. To
   roll back, revert that commit and run `task check`.

Provider changes belong in `packages/provider/`, never in a file the lock lists.
