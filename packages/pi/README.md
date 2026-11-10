# pi

Pi provider extension for CommandCode.

Registers a native provider with `createProvider`, `fetchModels`, and Pi's built-in `openai-completions`, `openai-responses`, and `anthropic-messages` implementations. Maps catalog records to `ProviderChatModelConfig` with `thinkingLevelMap` and per-model `api`.

The extension does not implement `/alpha/generate` or any CommandCode CLI transport.
