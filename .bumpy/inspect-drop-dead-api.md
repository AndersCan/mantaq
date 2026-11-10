---
"@mantaq/inspect": minor
---

Breaking: `toViz`/`toVizMachine` no longer take `history` or `sampleContexts` (coverage comes from `fuzzedMachine` and `withTestCoverage`); removed `analyzeSource` (use `analyzeModule`). The viz "supplied run" coverage mode stays, but nothing in this repo produces it.
