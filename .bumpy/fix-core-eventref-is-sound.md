---
"@mantaq/core": patch
---

Make `EventRef.is()` a sound type guard (#240). `is()` now narrows to the event `type` tag only (`{ type: T }`) instead of over-promising the erased `Payload` generic. It cannot validate the payload at runtime (the generic is type-erased and the factory cannot pass payload-expectation to the constructor), so the guard no longer falsely narrows `e.payload` into scope — reading it after `is()` is now a compile error rather than a runtime `TypeError`. Use events produced by `create()` (already correctly typed) or validate the payload explicitly when you need it.
