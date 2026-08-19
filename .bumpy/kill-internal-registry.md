---
"@mantaq/core": minor
"@mantaq/sugar": patch
"@mantaq/traversal": patch
---

Deleted the internal registry and its `@mantaq/core/internal` entry point. Output fan-out is now a public `on("output")` subscriber hook; actors gained public `inject(event)` and terminal `dispose()`.
