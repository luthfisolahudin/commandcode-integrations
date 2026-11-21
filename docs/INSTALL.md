# Install this provider

Run `pnpm install --frozen-lockfile` and configure the API key described in the README.

In Pi, load `adapters/pi/src/index.ts` as an extension. Existing Pi shims documented in the README still resolve.

In OpenCode, add the checkout directory as a file plugin with `file://<absolute-checkout-path>`. The package manifest resolves its adapter.

Verify with `pi --list-models`, `opencode models`, and `pnpm run check:catalog --live`.
