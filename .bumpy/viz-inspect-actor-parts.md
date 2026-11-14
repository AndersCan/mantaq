---
"@mantaq/viz": minor
"@mantaq/inspect": minor
---

A factory that returns another machine next to its actor, such as a pool's inbox, now draws it as a part with arrows to and from the machine and the pool's workers. The viewer and fuzzing drive it too. Viz documents are schema 17.

Breaking: viz document schema 16 → 17 (new required machines[].actors). Affects tools that read viz JSON from an older @mantaq/inspect; the validator refuses with "schemaVersion: expected 17, got 16": rebuild with the matching inspect.
Breaking: a factory that returns another actor next to actor now draws it as a part. Affects factories that return a second actor (none in mantaq, justus, sandbox).
