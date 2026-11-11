# CommandCode integrations

Live model discovery and OpenAI Chat Completions for [CommandCode](https://commandcode.ai),
shared by Pi and OpenCode. The catalog is read from CommandCode's Provider API; no
model list is maintained by hand.

Built on [`ai-provider-integrations-template`](https://github.com/luthfisolahudin/ai-provider-integrations-template):
the engine, both adapters, the checks and the docs come from there, and this repo
owns only the CommandCode surface.

This integration uses CommandCode's **Provider API**. It does not emulate the CLI,
its `/alpha/generate` transport, its tool aliases, or its harness features.

## What this repo owns

| Path | Contents |
|---|---|
| `packages/provider/src/catalog.ts` | the two-view catalog merge, protocol routing, pricing |
| `packages/provider/src/pack.ts` | pack definition, discovery hook, credential fallback |
| `packages/provider/src/curated.ts` | (empty — the catalog declares everything) |
| `packages/provider/src/effort.ts` | (empty — the catalog declares the effort levels) |
| `packages/provider/src/invariants.ts` | (empty — routing is verified live, not per model) |
| `packages/provider/fixtures/` | the two captured catalog views and their merge |
| `packages/pi`, `packages/opencode` | shims over the shared adapters, keeping documented paths |
| `verify-live.ts` | one tiny request per wire protocol, with status and reasoning tokens |

## Install

### Pi

```jsonc
// ~/.pi/agent/settings.json
{ "extensions": ["<path-to-checkout>/packages/pi/src/index.ts"] }
```

### OpenCode

```jsonc
// opencode.json
{ "plugins": ["file://<path-to-checkout>/packages/opencode/src/index.ts"] }
```

Both paths are shims that re-export the shared adapters, so an existing
configuration keeps working. Paths are placeholders: an absolute path is
machine-specific. See `docs/INSTALL.md`.

Authentication, in order: `COMMANDCODE_API_KEY`, then
`~/.pi/agent/commandcode/auth.json`, then `~/.commandcode/auth.json`. One key only.

## Verify

```sh
task setup
task check            # typecheck, unit tests, conformance, invariants, doctor
task check:catalog    # project the merged fixture, assert the invariants
task report --write   # regenerate docs/PROVIDERS.md
task pricing          # print the T3 Code price block for this provider
pnpm verify:live      # one request per wire protocol against the API
```

## Routing

Chat-first:

| Model | Route | Why |
|---|---|---|
| Claude | Anthropic Messages | adaptive thinking and effort live there |
| everything else | OpenAI Chat Completions | 72 models list both routes; chat answered for all |
| Responses-only | OpenAI Responses | no visible model needs it today |

A `403` is plan gating, not a routing failure. `hidden` models are dropped before a
picker sees them; `reasoningEfforts` from the catalog drive the effort menu, and a
model with none gets no menu.

## License

MIT.
