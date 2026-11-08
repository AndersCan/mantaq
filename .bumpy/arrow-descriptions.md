---
"@mantaq/viz": minor
"@mantaq/inspect": minor
---

A handler (`m.on`, `m.onAny`) or a state's effects with no `/** */` comment are now naming notes that name the event, state, file and line.

Breaking: `expectNoDesignErrors` with `source`, and `mantaqViz({ failOnFindings: true })`, now fail on a handler or a state's effects with no `/** */` comment. This affects machines with such handlers: add the comment.
