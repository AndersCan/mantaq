---
"@mantaq/core": patch
---

VirtualClock.advance() terminates when a timer callback re-arms a same-deadline timer (#197).
