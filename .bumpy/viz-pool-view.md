---
"@mantaq/viz": minor
"@mantaq/inspect": patch
---

A machine with an actor map is drawn as one diagram: its own states and one child's, with no system board. A line under the diagram counts each map's children by state; click a count to show a child. Child pills are gone, and the harness's `children()` returns children sorted by key. Breaking: the pool and actor-map DOM loses `g.child-marker`, `g.child-dot` and `[data-open-part-tab]` for maps, and the Step tab shows one child row per map, so scripts that scraped them break.
