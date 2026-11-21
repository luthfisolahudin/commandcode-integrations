---
name: sync-upstream
description: Update the copied runtime and tooling from a tagged ai-integrations release.
---

# Sync the upstream packages

1. Run `pnpm run sync:upstream --tag <version>`, then `git diff`.
2. Review `packages/runtime`, `packages/dev` and `ai-integrations.lock.json` together.
   Vendor files (`packages/provider`, `adapters/*`) are never touched.
3. Run `pnpm check`, then commit the three paths in one commit. Revert that
   commit to roll back.
