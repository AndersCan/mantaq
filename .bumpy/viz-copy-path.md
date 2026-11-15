---
"@mantaq/viz": patch
"@mantaq/inspect": patch
---

The Path tab has a Copy path button. A payload form now fills from what parts sent each other in the walk, so sending `ITEMS_FINISHED` by hand reports a real worker (`w1`), not `sample`. When a step changes nothing, the Step tab says so. Open receiver lands on the state the receiver is in now. The live driver records each message's payload.
