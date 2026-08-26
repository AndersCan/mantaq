---
"@mantaq/core": none
---

Add a regression assertion that `recover()` hands out the recovered context via
the copy-on-read `snapshot().context` API (#269). No published code change — the
cache-invalidation path is already correct on `main` (since #257).
