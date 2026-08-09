---
"@mantaq/core": patch
"@mantaq/traversal": patch
"@mantaq/test": patch
"@mantaq/pbt": patch
---

Context in handlers and effects is now a handle (`context.get()` / `context.set()`), and `set()` replaces the whole context — so context writes emit a `change` event even without a transition. Snapshots now carry `context`, and change handlers receive the previous snapshot (`(snapshot, prev)`) for identity comparison.
