# CommandCode integrations

CommandCode model catalog and provider integration for OpenCode and Pi.

The integration uses CommandCode's Provider API and the client model catalog. It does not emulate the CommandCode CLI, its `/alpha/generate` transport, or its harness features.

## Packages

| Package | Purpose |
|---|---|
| `packages/core` | Host-neutral catalog, protocol routing, thinking maps, pricing, and auth |
| `packages/opencode` | OpenCode provider plugin |
| `packages/pi` | Pi provider extension |

Design: [docs/design.md](docs/design.md)

## Routing

The policy is chat-first for reliability:

- Claude models use Anthropic Messages (`/messages`).
- Every non-Claude model with `/chat/completions` uses OpenAI Chat Completions.
- OpenAI Responses is used only when Chat is not supported, or when a generated protocol cache marks Chat as broken.

The current visible catalog resolves to:

| Protocol | Models |
|---|---:|
| Anthropic Messages | 12 |
| OpenAI Chat Completions | 85 |
| OpenAI Responses | 0 |

Model capabilities, effort levels, and pricing come from `GET /provider/v1/models?view=client`. Endpoint support comes from `GET /provider/v1/models` (`supported_endpoints`). Effort levels are not probed at runtime.

## OpenCode

Add the local package to `opencode.json`:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "plugins": [
    {
      "package": "file:///path/to/commandcode-integrations/packages/opencode",
      "options": {
        "providerID": "commandcode",
        "apiKeyEnv": "COMMANDCODE_API_KEY"
      }
    }
  ]
}
```

Options:

| Option | Default | Purpose |
|---|---|---|
| `providerID` | `commandcode` | Provider ID |
| `name` | `Command Code` | Display name |
| `baseURL` | `https://api.commandcode.ai/provider/v1` | Provider API base URL |
| `apiKeyEnv` | `COMMANDCODE_API_KEY` | Environment variable containing the key |
| `apiKey` | unset | Literal key, if not using an environment variable |
| `includeHidden` | `false` | Include hidden/free catalog entries |
| `defaultMaxOutput` | `32768` | Output limit when the catalog does not declare one |

The plugin owns the provider inventory. Remove any hardcoded CommandCode model block from `opencode.json`.

## Pi

Load the extension directly:

```bash
pi --no-extensions -e /path/to/commandcode-integrations/packages/pi/src/index.ts --list-models commandcode
```

Or install it through Pi's normal extension/package flow. The extension registers a native provider with Pi's built-in `openai-completions`, `openai-responses`, and `anthropic-messages` implementations.

Pi persists the refreshed model inventory through `createProvider`. The factory also loads a cached baseline so `pi --list-models` works before the first network refresh.

## Authentication

The shared resolver checks, in order:

1. `COMMANDCODE_API_KEY`.
2. `~/.pi/agent/commandcode/auth.json` (`apiKey` or first `apiKeys` entry).
3. `~/.commandcode/auth.json` (`apiKey`).

Single key only. No key pool, rotation, or cooldown state.

Optional environment variables:

- `COMMANDCODE_BASE_URL` overrides the Provider API base URL.
- `COMMANDCODE_CACHE_PATH` overrides the catalog cache path.

## Development

```bash
pnpm install
pnpm check
pnpm test
```

Live verification, using the key from the auth resolver:

```bash
pnpm verify:live
```

Live verification prints model IDs, protocol, status, and reasoning-token counts. It never prints the API key.

## Security

Do not commit API keys, `.env` files, auth files, or personal data.

- The repository contains no credentials.
- Verification reads the key from the environment or the local auth files.
- Logs and errors omit the key.
- See [SECURITY.md](SECURITY.md) for reporting.

## License

MIT. See [LICENSE](LICENSE).
