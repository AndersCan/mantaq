---
"@mantaq/inspect": minor
---

The board, fuzzing, `recordRuns` and the design checks read `machine(id, { create })` exports. Each one is built on a virtual clock of its own, so a machine with no timers needs no clock. `InspectTarget` accepts `{ machine }`. A machine that builds its actor on another clock is drawn, not fuzzed, with one warning. Plain factories keep working until the next release.
