---
"@mantaq/viz": patch
---

Escape goes back one level of the path from anywhere in the viewer, not only from the canvas or the path. If a Details panel with a selection is open, Escape closes it first. After a `?focus=` link opens a group and nothing has focus, Escape also goes back, when this viewer is the only one on the page that shows a path. Escape in a text field does nothing.

The current crumb of the path is plain text: it has no frame and no focus ring, but focus still lands on it so that a screen reader says where the reader is.

If a `?focus=` link names a machine or a group that is not there, the bar says so, for example `No group "@nowhere" in shop. The link opens shop.`, until the next move along the path.
