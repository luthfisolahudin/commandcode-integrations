# Pricing

Three places can hold a price, and they are not interchangeable.

## 1. models.dev (the default source)

The engine reads `input`, `output`, `cache_read`, `cache_write` from the
models.dev entry for a model and treats them as **USD per 1M tokens**. When no source publishes a rate, its provenance is `default`.

That price is a hint, not a billing contract: models.dev lists the same model
once per gateway, so the engine takes the most common published value and any
gateway markup is invisible. `task report --write` shows `cost/1M` and `price-src`.

## 2. The pack (per model, authoritative)

Two pack fields exist for the cases models.dev cannot serve:

```ts
// packages/provider/src/pack.ts
aliases: {
  // The provider names it differently; look up the models.dev entry by this key.
  "deepseek-v4.1-flash-uncensored": "deepseek-v4.1-flash",
},
curated: {
  // An explicit price. Wins over models.dev, and is recorded as `curated`.
  "my-local-model": { cost: { input: 0.2, output: 0.8 } },
},
```

For each rate, the engine checks curated overrides, rates mapped by the provider
pack from its catalog, then models.dev hints. The catalog must supply a rate in
USD per million tokens, or the pack must convert it to those units. An explicit
zero keeps its source. Pi requires numeric rates, so it receives a zero placeholder
for missing rates. Reports show missing rates as a dash.

An alias also redirects limits, modalities and reasoning, since it changes the
metadata lookup key, not just the price. It never adds membership: a model that
is not in the provider catalog stays absent.

Guts AI publishes `price_per_1m` as a blended input and output rate in IDR.
That rate has no direct mapping to the four USD cost fields.

## 3. T3 Code usage estimates

T3 Code keeps its own overrides in `~/.t3/userdata/settings.json`. Verified
shape on this machine:

```jsonc
{
  "usagePriceOverrides": {
    "example/deepseek-v4.1-flash": {
      "inputCostPerMillionTokens": 0.3,
      "outputCostPerMillionTokens": 1.2,
      "cacheReadCostPerMillionTokens": 0.006
    }
  },
  "usageModelAliases": {
    "example/kimi-k3.1-pro": "kimi-k3.1-pro"
  }
}
```

- the key is `<providerId>/<modelId>`, exactly as the harness reports it;
- `usageModelAliases` maps that key to a canonical model id so one model served
  by several gateways aggregates into one usage row;
- `~/.t3/userdata/usage-model-rates.json` is a fetched rate table (LiteLLM
  style, per-token) used as a fallback source; it is a cache, not yours to edit.

Two consequences for this repo:

1. **Never normalize a model id.** Aliases are keyed by the id the harness sees,
   so renaming `deepseek-v4.1-flash-1017` to `deepseek-v4.1-flash` would silently
   split or merge usage rows.
2. **Check pricing provenance when the picker shows zero.** The rate may be
   published as zero or missing. Use a curated override when you have a known rate.

The settings file is the source of truth. T3 Code applies it without restarting
the harness, and any settings panel in the app writes the same keys. Edit the
file when you want a change that survives a reinstall of the app.

## Generating the T3 Code block from this repo

Each provider repo can produce, compare, or apply its own slice of T3 Code's
pricing. The command is scoped by provider id, so running it from two repos never
fights over the same keys.

```sh
task pricing                  # dry run: print the JSON fragment
task pricing -- --write       # merge into ~/.t3/userdata/settings.json
task pricing -- --check       # compare; exit 1 on drift (useful in CI or a task)
task pricing -- --write --prune   # also drop entries for models this repo dropped
task pricing -- --live        # price from the live catalog instead of the fixture
```

What it writes, and what it refuses to write:

- a price override when there are known input and output rates, including
  explicitly published zero rates;
- a cache-read rate when it is known;
- `usageModelAliases` from `pack.aliases`, and only for models present in the
  catalog;
- nothing outside `<providerId>/` keys. Other providers' entries and every other
  settings key are preserved, in their original order.

`--write` copies the file to `settings.json.bak-<timestamp>` first and reuses the
file's own indentation, so a rewrite does not reflow a hand-edited settings file.
`T3_SETTINGS_PATH` overrides the location for non-standard installs or tests.

A typical loop: change a price in `curated`, run `task pricing -- --check` (it
reports the drift), then `task pricing -- --write`, then restart nothing — T3
reads the file.
