---
"@mantaq/core": patch
"@mantaq/sugar": patch
---

Fix ActorMap.kill() resource leak by aborting child actor effects and clearing subscribers.
