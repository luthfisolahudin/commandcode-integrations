# Update the copied packages

`packages/runtime` and `packages/dev` are copies from a tagged release of
`luthfisolahudin/ai-integrations`.

```sh
pnpm run sync:upstream --tag v2.2.0
git diff -- packages/runtime packages/dev ai-integrations.lock.json
pnpm check
```

`ai-integrations.lock.json` lists every copied file with its sha256. `pnpm check`
verifies it first, so editing a copied file is a lock violation, not a quiet
fork. The upstream-owned names (`ai-integrations-*`) are identical in every
checkout, so the copy needs no rewrite of package names or imports.

Commit `packages/runtime`, `packages/dev`, and the lock in one commit. To roll
back, revert that commit and run `pnpm check`.
