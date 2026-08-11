---
"@mantaq/core": minor
"@mantaq/sugar": minor
"@mantaq/traversal": minor
"@mantaq/test": minor
---

Breaking: events are now envelopes { type, payload } instead of flat { id, ...payload }. EventRef.id renamed to .type. Payload id can no longer be clobbered by the event type. All payload reads move to event.payload.*
