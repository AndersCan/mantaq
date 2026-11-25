---
"@mantaq/viz": minor
"@mantaq/inspect": minor
---

States can belong to a group that the viewer can fold. Tag a state declaration with `@group <name>` in its JSDoc, for example `/** The card is charged. @group payment */`. Inspect puts the name in the new optional `VizState.group` and cuts the tag from `doc`. Inspect leaves the group off, without a warning, for a state in an actor map, a state name used in more than one region scope, a name that contains `.`, and a group that reaches more than one region scope. `validateViz` rejects an empty group name, a name that contains `.`, a group whose states are in more than one region scope, and a group in an actor map. Each issue names the path of the state.
