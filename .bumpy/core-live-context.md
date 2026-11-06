---
"@mantaq/core": minor
---

Snapshots hand out the live context instead of a deep copy (reverses #226). Unchanged parts keep identity; `Snapshot.context` is typed `Readonly<C>`.
