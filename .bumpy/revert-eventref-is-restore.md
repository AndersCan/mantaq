---
"@mantaq/core": patch
---

Revert #258: restore `EventRef.is()` to its pre-#258 contract that narrows to the
full `CreatedOfEvent<T, Payload>` (payload stays in scope), instead of the
type-tag-only guard. The tag-only guard over-promised soundness while breaking
callers that read `e.payload` (red-CI-class friction across consumers). A sound
symbol-brand replacement is tracked in #262.
