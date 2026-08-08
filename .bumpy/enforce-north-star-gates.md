---
"@mantaq/core": patch
"@mantaq/test": patch
---

Enforced the north star as machine checks: vision-guard bans type escapes in core and caps exports and impl size; added type-level tests. Removed InternalActorOptions from the public API, eliminated all type escapes in core, and tightened transition typing so targets and emitted events must be declared.
