---
"@mantaq/lit": patch
---

A `watch` inside another `watch` now stops listening when its part is cleared, also after the chain got shorter. Before, it could keep listening and draw an old page over the new one.
