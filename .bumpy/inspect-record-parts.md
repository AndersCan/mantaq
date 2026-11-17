---
"@mantaq/inspect": minor
---

recordRuns now also records the steps a test makes on the other machines a factory returns, as actor.region steps, and replay drops the ones a wire already delivers. Breaking: a test whose factory returns other machines must refresh its committed **runs** file once, without CI set.
