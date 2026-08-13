---
"@mantaq/sugar": patch
---

Fixed ActorMap auto-reap leaking dead children: done-reaped actors kept their reaper entry alive, pinning the full child closure graph and growing unbounded per completed key.
