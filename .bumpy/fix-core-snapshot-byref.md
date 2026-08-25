---
"@mantaq/core": patch
---

Snapshot hands subscribers a defensive copy of the actor context instead of the live reference (#226). `Snapshot.context` and `Snapshot.error.context` are deep-cloned; unchanged snapshots keep a stable context identity so `prev.context === snap.context` still signals "no context change".
