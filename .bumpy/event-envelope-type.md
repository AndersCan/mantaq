---
"@mantaq/core": major
"@mantaq/sugar": major
"@mantaq/traversal": major
"@mantaq/test": major
---

Breaking: events are now envelopes { type, payload } instead of flat { id, ...payload }. EventRef.id renamed to .type. Payload id can no longer be clobbered by the event type. All payload reads move to event.payload.*
