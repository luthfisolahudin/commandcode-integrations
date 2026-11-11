# Contributing

```sh
task setup     # pnpm install --frozen-lockfile
task check     # typecheck, unit tests, boundaries, doctor
task conformance
```

Rules that matter more than style:

1. **The template stays vendor-free.** No provider URL, models, or quirks belong
   in `packages/contract`, `packages/catalog`, `packages/cli`, or
   `packages/conformance`. Those are the shared engine; a vendor lives in
   `packages/provider` downstream.
2. **The three examples stay representative.** `examples/tier-b` and
   `examples/tier-c` exist so the engine is proven against catalogs that do not
   describe themselves. Keep them shaped like real providers, not like fixtures
   that happen to pass.
3. **Tests encode evidence.** A test that asserts "no observable difference"
   should be traceable to a probe, either in `docs/THINKING.md` or in the test
   name itself.
4. **No new runtime dependencies** unless the alternative is worse. The engine
   uses Node built-ins only.
5. **A `PACK_SCHEMA_VERSION` bump needs a migration note** in `docs/SYNC.md`,
   because every downstream repo will have to apply it.

Commit messages: imperative subject, and say what changed for a downstream repo
when the engine changes.
