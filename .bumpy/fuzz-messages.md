---
"@mantaq/viz": minor
"@mantaq/inspect": minor
---

Fuzzing records each message one machine sends another, with the state it was sent from and the arrow that took it, in `machine.fuzz.messages`. Viz documents are schema 18.

Breaking: viz document schema 17 → 18, a new required `machines[].fuzz.messages`; the validator refuses a 17 document with `schemaVersion: expected 18, got 17`. Rebuild with the matching @mantaq/inspect.
Breaking: the board's dotted lines will follow the recorded messages once the viewer reads them; lines for same-named but unwired events then disappear, and lines for renamed wires and `onAny` handlers appear.
