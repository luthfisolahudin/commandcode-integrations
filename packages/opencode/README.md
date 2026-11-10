# opencode

OpenCode provider plugin for CommandCode.

Registers the `commandcode` provider through `Plugin.define` and `ctx.provider.transform`. Maps catalog records to `Model.Info`, including model-level packages and variants. Uses `ctx.storage` for the catalog snapshot and refreshes through `ctx.provider.reload()`.
