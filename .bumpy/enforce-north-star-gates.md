---
"@mantaq/core": patch
"@mantaq/test": patch
---

Enforced the north star as machine checks: vision-guard bans type escapes in core, caps exports and impl size, and bans wall-clock/randomness sources in the runtime — determinism is now a north star axis; added type-level tests. Removed InternalActorOptions from the public API, eliminated all type escapes in core, and tightened transition typing so targets and emitted events must be declared.
