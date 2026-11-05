---
"@mantaq/inspect": minor
---

Add `expectReached` and `expectAllStatesReached` for tests: they fail when fuzzing or your example `tests` never visited the listed states or took the listed transitions. `missedReach` and `reachedStates` are exported for custom checks.
