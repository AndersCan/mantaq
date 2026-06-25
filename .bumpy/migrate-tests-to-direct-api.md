---
"@mantaq/core":
  bump: major
"@mantaq/sugar": patch
"@mantaq/test": patch
"@mantaq/traversal": patch
"@mantaq/viz": patch
---

Rewrite checkpoint: core Actor split into modules (queue, subscribers, dispatch, effects, snapshot, clocks, abort-tracker, actor-internal, actor-types) behind direct `transitions`/`effects` API. Removed `setup()` builder. Migrated 22 test files + sugar `withTimeout` (EffectInput 3-generic to 1-generic) to direct API. 405/405 runtime tests pass. Known type debt: 101 tsc errors from direct-API type gaps (event payload unknown, AnyActor/Actor mismatch, context inference) — next phase.
