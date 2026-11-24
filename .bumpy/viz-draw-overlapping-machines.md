---
"@mantaq/viz": patch
---

A machine whose layout overlaps itself is drawn anyway, with a warning line under it ("2 overlaps: some labels or lines touch."). Before, the viewer showed only "Cannot draw" and the machine name. A big machine also lays out faster: the second dagre pass reuses the order of the first, and the overlap check does less repeated work.
