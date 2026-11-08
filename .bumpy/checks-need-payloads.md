---
"@mantaq/inspect": minor
---

`expectReached`, `expectAllStatesReached` and `expectNoDesignErrors` stop when fuzzing sent an event without a payload and the machine read a field of it. The error names each event and the fields read, and says to pass `source` or `payloads`. Before, such a check passed on an event the app cannot send, blamed the handler for a payload the types forbid, or told you to raise `fuzz.iterations`.

Breaking: expectReached, expectAllStatesReached and expectNoDesignErrors now fail when fuzzing sent an event without a payload and the machine read one — affects tests without source or payloads for such events: add them.
