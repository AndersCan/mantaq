---
"@mantaq/viz": minor
"@mantaq/inspect": patch
---

Remove the unused `@mantaq/viz/live` page entry and `mountLive`; the Vite plugin page comes from `@mantaq/inspect`.

Breaking: the `@mantaq/viz/live` subpath export is removed — affects code importing `@mantaq/viz/live` directly (none known). Import `mountViewer` or `mountVizText` from `@mantaq/viz/viewer` instead.
