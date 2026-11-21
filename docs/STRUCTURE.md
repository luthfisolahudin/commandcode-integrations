# Integration layout

`packages/provider/` owns vendor data, fixtures, and rules. `engine/` is pinned by `engine.lock.json`. `adapters/` registers this pack in each host. The contract and catalog workspace packages re-export the copied engine for checks and diagnostics. [Engine updates](SYNC.md)
