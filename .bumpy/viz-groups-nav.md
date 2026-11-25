---
"@mantaq/viz": patch
---

Escape goes back one level of the path from anywhere in the viewer, not only from the canvas or the path. If a Details panel with a selection is open, Escape closes it first. When nothing on the page has focus, for example after a click on text or after a `?focus=` link opens the page, Escape goes to the viewer that was last clicked or focused, or else to the viewer that the link opened on a path. Escape in a text field does nothing.

The current crumb of the path is plain text: it has no frame and no focus ring, but focus still lands on it so that a screen reader says where the reader is.

If a `?focus=` link names a machine or a group that is not there, the bar says so and lists what is there, for example `No group "@nowhere" in shop. The link opens shop. Groups here: @payment, @shipping.`, until the next move along the path or the next step. An empty `focus=` value is ignored.
