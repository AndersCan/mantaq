---
"@mantaq/test": major
---

**Breaking.** `harness.graph` (the traversal `ActorGraph`) now has a `*`
any-node and one edge per declared target, which changes coverage totals.
`onAny` transitions are also counted correctly in coverage (#309).
