---
"@mantaq/viz": minor
"@mantaq/inspect": minor
---

A state can embed another machine of the same document by reference: `states[].machine` is that machine's id. Viz documents are schema 19. The validator refuses a reference to a machine that is not in the document, and a machine that embeds itself through a chain of embeds.

Breaking: viz document schema 18 → 19. The validator refuses an 18 document with `schemaVersion: expected 19, got 18`. Rebuild with the matching @mantaq/inspect.
