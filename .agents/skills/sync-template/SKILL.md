---
name: sync-template
description: Merge a new release of the shared engine template into this provider repo. Use when the template publishes a tag, when the pack schema version is behind the engine, or when the user asks to sync, upgrade, or update the integration from the template.
---

# Sync the template

This repo owns exactly one package: `packages/provider`. Everything else is
synced from the template. A sync is a tagged git merge, not a copy, and the lock
file tells the tooling which paths are yours.

## Preconditions

- Working tree clean. If it is not, commit or stash first; the command refuses.
- You know the target tag.
- The template remote exists. If it does not:
  `git remote add template git@github.com:luthfisolahudin/ai-provider-integrations-template.git`

## Procedure

1. Dry run: `task sync:template`. It prints the current version, the owned paths
   and the deleted paths, and refuses on a dirty tree.
2. Apply: `task sync:template -- --apply --yes --version <tag>`.
3. Read what it did:
   - conflicts on owned paths are resolved to **ours** automatically;
   - a modify/delete on a deleted path resolves to **deletion**;
   - any remaining engine conflict aborts the sync with nothing committed.
4. If the command stops on an engine conflict, decide it deliberately. Never
   resolve inside the engine packages by hand-picking hunks: take the template's
   side and move your logic into `packages/provider`.

## When the pack schema version changes

A `PACK_SCHEMA_VERSION` bump means the pack contract changed. Read the migration
note in `docs/SYNC.md`, apply it to `packages/provider/src/pack.ts`, then run
`task check` and `task check:catalog` before committing.

## Never

- Never merge two template tags in one step.
- Never edit the lock file by hand; the command writes it after `task check`
  passes.
- Never copy a package from the template checkout over yours; it loses the merge
  base and the next sync conflicts everywhere.
