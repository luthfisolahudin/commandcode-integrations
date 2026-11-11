# Vendor notes — Command Code

Repo-owned. Things a future reader would otherwise rediscover the hard way.

- Base URL: `https://api.commandcode.ai/provider/v1`
- Key resolution, in order: `COMMANDCODE_API_KEY`, then
  `~/.pi/agent/commandcode/auth.json` (`apiKey`, then the first `apiKeys` entry),
  then `~/.commandcode/auth.json` (`apiKey`). One key only; a rejected key is a
  configuration error, not a failover event.
- **Two catalog views**; discovery merges them. The client view wins for facts, the
  public list wins for `supported_endpoints`. If the client view fails, the public
  list still yields models without efforts or prices.
- **Set a real User-Agent.** Cloudflare answers `403 error code: 1010` to Python's
  default agent.
- **`hidden` entries are real** and are dropped before a picker sees them.
- **`minimumPlan` gates access with 403**, not with routing: a plan-gated model
  still routes correctly and must not be treated as a broken endpoint.
- **`catalogVersion` + `refreshAfterSeconds`** are the router's own cache hints. The
  pack ignores them; the engine refreshes on its TTL and the adapter caches the
  snapshot, which is simpler and always the same shape for every provider.
- **Context tiers in `pricing.contextTiers` are ignored.** The host model shape has
  a single input/output price, and a tier silently applied to the wrong request size
  is worse than no tier at all. `docs/PRICING.md` covers overrides.
- Models with an empty or null `reasoningEfforts` get no effort menu, not a default
  one.
