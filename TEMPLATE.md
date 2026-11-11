# Using this as a template

This repository is both a working integration and the source of truth for the
integration engine. Two ways to use it:

## Start a new provider repo

`task init -- --id <id> --name "<Name>" --base-url <url> --api-key-env <ENV>`
(the command prints the plan first; `--yes` applies it). It renames the provider
package, renders `README.md`, deletes `examples/`, and writes the lock file.

Or use GitHub's "Use this template", which gives you the same tree with a fresh
history — but no update path. Prefer the git remote (below) if you want future
engine improvements.

## Adopt it into an existing repo, keeping history

```sh
git remote add template git@github.com:luthfisolahudin/ai-provider-integrations-template.git
git fetch template --tags
git merge --allow-unrelated-histories --no-commit v0.1.0
```

Then keep your identity files, take the engine paths, move your provider code
into `packages/provider`, and commit. Full recipe: `docs/SYNC.md`.

## Keep it updated

```sh
task sync:template -- --apply --yes --version v0.4.0
```

One merge per template tag. Conflicts on repo-owned paths resolve automatically,
and the command refuses to commit unless `task check` passes.

## What stays yours

`packages/provider/**`, `docs/EVIDENCE.md`, `docs/REPO.md`, `docs/PROVIDERS.md`,
`README.md`, `LICENSE`, and the `name`/`description` fields. Everything else is
engine and arrives through the merge.

## Adding to the template

The template must stay vendor-free: no provider URLs, ids, or quirks outside
`examples/`. If a change only makes sense for one vendor, it belongs in that
vendor's repo as a pack hook, not here. See `CONTRIBUTING.md`.

## Package names

Every workspace package is `<scope>/<repo>-<suffix>`:

| Directory | Package |
|---|---|
| `packages/contract` | `@luthfisolahudin/ai-provider-integrations-template-contract` |
| `packages/catalog` | `…-catalog` |
| `packages/provider` | `…-provider` |
| `packages/cli` | `…-cli` |
| `packages/conformance` | `…-conformance` |
| `adapters/pi` | `…-pi` |
| `adapters/opencode` | `…-opencode` |
| `examples/tier-b`, `examples/tier-c` | `…-tier-b`, `…-tier-c` |

`task init` rewrites that prefix for your repo — package `name` fields, import
specifiers, and the `tsconfig.json` path map — so a downstream repo ends up with
`@luthfisolahudin/cosmoshub-integrations-catalog` and friends. The rewrite is
idempotent: running it twice changes nothing.
