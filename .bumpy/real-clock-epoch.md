---
"@mantaq/core": minor
---

Breaking: `RealClock().now()` now returns milliseconds since the Unix epoch (`Date.now()`), not milliseconds since the clock was constructed. `VirtualClock` is unchanged and still starts at 0.
