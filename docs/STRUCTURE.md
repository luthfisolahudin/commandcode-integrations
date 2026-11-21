# Structure

Focused packages; layers are derived from the package name and the file path in
[the boundary checker](../packages/dev/cli/src/commands/boundaries.ts).

| Owner | Paths |
|---|---|
| Upstream runtime | `packages/runtime/{contract,catalog}` |
| Upstream host factories | `packages/runtime/{pi,opencode}` |
| Upstream tooling (dev) | `packages/dev/{cli,conformance}` |
| Vendor data and fixtures | `packages/provider` |
| Host wiring (thin) | `adapters/pi`, `adapters/opencode` |

`packages/runtime/**` and `packages/dev/**` are copied from
[luthfisolahudin/ai-integrations](https://github.com/luthfisolahudin/ai-integrations)
and pinned by `ai-integrations.lock.json`. Everything else is owned here.

See [the update procedure](SYNC.md).
