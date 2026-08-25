---
"@mantaq/core": patch
---

Make `EventRef.is()` a sound type guard via a per-type symbol brand (#262).
`create()` stamps a non-enumerable brand onto the envelope; `is()` verifies it,
so only `create()`-produced events satisfy the guard and payload narrowing is
preserved without a runtime payload walk or `@ts-*` escapes.
