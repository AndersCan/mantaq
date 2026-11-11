---
"@mantaq/viz": minor
"@mantaq/inspect": minor
---

Record which parts of a machine talk. `VizMachine.partOutputs` (schema 16) holds the declared outputs of each region and actor map child, and `systemOf` joins them to the parts that handle them. A step that moves other parts says so: the Path reads `team.ITEM_ARRIVED {item a}, then w1: free → working`, and the panel says `Then w1 took team.ITEMS_ASSIGNED` instead of "came back".

Breaking: documents with `schemaVersion` 15 are refused; regenerate them. Hand-built `VizMachine` values need `partOutputs: {}`.
