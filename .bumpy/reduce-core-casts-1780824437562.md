---
"@mantaq/core": patch
---

Reduced unnecessary type casts in actor.ts by consolidating duplicate event.id lookups and removing redundant casts on state.name and region.initial.
