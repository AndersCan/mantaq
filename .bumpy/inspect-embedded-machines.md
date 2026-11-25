---
"@mantaq/inspect": minor
---

Inspect draws embedded machines. When a state runs another machine with `embed` from `@mantaq/sugar`, the state gets `machine` (the id of that machine), and the document gets that machine as its own entry. Inspect fuzzes the embedded machine as if a file exported it. The Vite page, `viz.json`, the Astro documents and `toViz` hold each embedded machine once. A machine that a file also exports is not added a second time. `inspect()` and `inspectModule()` return the new `embedded` list. If a reference makes a cycle, goes more than 8 machines deep, or names a machine that cannot be built, inspect leaves it off the state and warns.
