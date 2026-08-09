---
"@mantaq/core": patch
---

Context writes now emit change even when set() receives the same reference — in-place mutation of a class-instance context is detectable by writing through set(). Change detection stays reference-identity; deep comparison of arbitrary context values is not supported.
