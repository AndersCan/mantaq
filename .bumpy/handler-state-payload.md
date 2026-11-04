---
"@mantaq/core": patch
---

Transition handlers receive the typed current state as `state: { name, payload }`, so a handler can carry the payload into the next state without a guard.
