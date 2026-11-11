# Syncing this repo with the template

The engine (`packages/contract`, `packages/catalog`, `packages/cli`,
`packages/conformance`, `adapters/*`, `examples/*`, CI, tooling) is owned by the
template. Your vendor lives in `packages/provider`.

## One-time adoption

```sh
git remote add template git@github.com:luthfisolahudin/ai-provider-integrations-template.git
git fetch template --tags
git merge --allow-unrelated-histories --no-commit v0.1.0
# keep your identity files, take the engine
git checkout HEAD -- README.md LICENSE package.json
git checkout v0.1.0 -- packages adapters examples docs tsconfig.json \
  Taskfile.yaml mise.toml .node-version .editorconfig .gitignore .gitattributes \
  renovate.json pnpm-workspace.yaml .github .agents AGENTS.md CLAUDE.md .claude
pnpm install && task check
git commit -m "Adopt ai-provider-integrations-template v0.1.0"
```

`--allow-unrelated-histories` keeps every commit you already have; the template's
commits join as a second root. That shared merge base is what makes later syncs
ordinary three-way merges. The cost is honest: the template's own commits appear
in your log.

## Ongoing sync

```sh
task sync:template                                  # dry run
task sync:template -- --apply --yes --version v0.4.0
```

The command refuses on a dirty tree, resolves conflicts on `owned` paths to
yours, resolves modify/delete on `deleted` paths to deletion, runs `task check`,
then commits with a `Template-Source:` trailer and bumps the lock file.

## The lock file

```json
{
  "template": "luthfisolahudin/ai-provider-integrations-template",
  "version": "0.1.0",
  "packSchemaVersion": 1,
  "identity": { "name": "cosmoshub-integrations", "description": "…" },
  "owned": ["README.md", "packages/provider/**", "docs/EVIDENCE.md", "docs/REPO.md", "template.lock.json"],
  "deleted": ["examples/**"]
}
```

Never edit it by hand. The only fields the sync tool rewrites are `version` and,
for a fresh init, the whole file.

## When `PACK_SCHEMA_VERSION` changes

A bump means `definePack` gained, renamed, or removed fields. The template ships
the migration in `docs/STRUCTURE.md`; apply it to
`packages/provider/src/pack.ts`, then:

```sh
task check
task check:catalog
```

## Symlinks

`CLAUDE.md -> AGENTS.md` and `.claude/skills -> ../.agents/skills` are committed
as mode `120000`. A Windows clone without symlink privilege writes `CLAUDE.md` as
a one-line text file. `task doctor` fails loudly with that diagnosis; fix it with
`git config core.symlinks true` and Developer Mode, or clone from `thunk`.

## Known limitation: a sync that changes this command

The command runs from your working tree, so a tag that rewrites
`packages/cli/src/commands/sync-template.ts` cannot apply its own fix-machinery
during that same run. When a template release changes the sync command itself,
the merge stops with `n` conflicts; resolve them by hand using the same rule the
command documents (template content, your package prefix, the root manifest merged
field-wise), commit, then run the command again to bump the lock.
