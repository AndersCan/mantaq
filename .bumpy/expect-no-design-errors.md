---
"@mantaq/inspect": minor
---

Add `expectNoDesignErrors` for tests: it fails on handlers that throw under fuzzing, effects that send an event their state does not handle, and declared states no path leads to. `designErrors` and `unreachableStates` are exported for custom checks.
