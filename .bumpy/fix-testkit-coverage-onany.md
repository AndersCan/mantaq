---
"@mantaq/testkit": patch
---

`computeCoverage` no longer counts the `onAny` pseudo-state as an unvisitable
state, and counts an `onAny` transition as covered once its event fired from
any state. `assertAllStatesVisited` and `assertAllTransitionsVisited` can now
pass for machines that use `onAny`.
