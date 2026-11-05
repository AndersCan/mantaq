---
"@mantaq/inspect": minor
---

Add `recordRuns(factory)` (`@mantaq/inspect/record`) for vitest. Wrap a machine factory in a test file and each passing test is recorded to `__runs__/<test file>.json` next to it, where `inspectModule` picks it up as a named run. With `CI` set, a stale file fails the test. `vitest` is an optional peer dependency.
