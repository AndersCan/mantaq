---
"@mantaq/sugar": patch
---

`withTimeout` now labels its timer with the emitted event's type, so `pendingTimers()` shows it. The `Emit` type parameter is now constrained to `InternalEvent`. The event factory is called once when the timer is scheduled (for the label) and again when it fires.
