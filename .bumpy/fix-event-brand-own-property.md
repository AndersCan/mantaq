---
"@mantaq/core": patch
---

`EventRef` brand is now a non-enumerable own property stamped by `create()`, and
`is()` checks it with `Object.hasOwn`. The per-envelope `WeakMap` registry is
gone. `toEqual`, JSON, and spread behavior are unchanged (#262, #264).
