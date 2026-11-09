---
"@mantaq/inspect": minor
---

Fuzz runs and test replays record actor-map children: child states and edges get coverage, and child handler errors become findings.

Breaking: none. Machines with actor maps now get coverage on child states and may get new findings on them, so a `failOnFindings` build can newly fail on a real bug.
