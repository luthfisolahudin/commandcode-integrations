# Installing an integration

Each provider repo exposes two entrypoints from its root manifest:

| Harness | Manifest key | Path |
|---|---|---|
| Pi | `pi.extensions` | `adapters/pi/src/index.ts` |
| OpenCode | `main` / `exports["."]` | `adapters/opencode/src/index.ts` |

The integration needs its workspace installed (`pnpm install`) once per machine.

## Pi

```jsonc
// ~/.pi/agent/settings.json
{
  "extensions": [
    "<path-to-checkout>/adapters/pi/src/index.ts"
  ]
}
```

Resolve `<path-to-checkout>` yourself — do not commit an absolute path, it is
machine-specific and leaks your directory layout. Verify with:

```sh
pi --list-models        # the provider id from the pack must appear
```

## OpenCode

```jsonc
// opencode.json (or ~/.config/opencode/opencode.json)
{
  "plugins": [
    "file://<path-to-checkout>/adapters/opencode/src/index.ts"
  ]
}
```

`file://` wants an absolute path. OpenCode also accepts a relative path resolved
from the config file, which is a cleaner way to avoid machine paths when the
checkout sits next to your dotfiles.

Verify with `opencode models` and check the provider id.

## Why a git spec does not work (yet)

`github:owner/repo#semver:^0.1.0` looks appealing, and both harnesses document a
git source: Pi accepts `pi install git:github.com/owner/repo@v1`, and
`opencode plugin add` takes an "npm registry or Git package specifier". It still
fails for this repo shape, for two reasons verified on Pi 1.5.0:

```text
Cloning into '…/.pi/agent/tmp/extensions/git-github.com/<hash>/<owner>/<repo>'...
npm error code EBADDEVENGINES
npm error EBADDEVENGINES Invalid name "pnpm" does not match "npm" for "packageManager"
npm error required: { name: 'pnpm', version: '12.18.0+sha512…', onFail: 'error' }
Warning: Extension package "git:…@v0.2.1": failed to install
         (npm install --omit=dev --legacy-peer-deps … failed with code 1)
```

1. Pi installs git packages with **npm**, and npm enforces
   `devEngines.packageManager`, which names **pnpm** on purpose.
2. Even past that, npm cannot resolve the `workspace:*` dependencies that tie the
   engine packages together. OpenCode's installer has the same problem: the repo
   root is a workspace, not a self-contained package.

So a git spec would need a **distribution artifact**, not the source repo. Three
ways, in increasing cost:

| Option | What it needs |
|---|---|
| Publish per-harness packages to npm | `@scope/<repo>-pi` and `-opencode` as real packages with their own deps; the harness then installs by name and version |
| Bundle a single file per harness | `dist/pi.mjs` with dependencies inlined, committed to a `dist` branch; `pi.extensions` points at it, so `npm install` has nothing to resolve |
| Mirror repos | CI pushes the built adapter to a thin read-only repo per harness (the pattern `pantheon-org/opencode-plugins` uses) |

None of these is required for a private, single-machine setup, which is why the
repo documents the local checkout instead. Revisit if an integration ever needs
to be installed by someone who does not clone it.
