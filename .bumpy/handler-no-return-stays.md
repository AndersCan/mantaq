---
"@mantaq/core": patch
---

A transition handler that returns nothing stays in the current state, the same as returning `{}`. It used to fail to compile and, at runtime, sent the actor to its error state. Breaking: none.
