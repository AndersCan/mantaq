---
"@mantaq/core": minor
---

Added on("error", fn) subscriber hook so the __error death signal is observable, including construction-time deaths (seeded to late subscribers) and cleared by recover().
