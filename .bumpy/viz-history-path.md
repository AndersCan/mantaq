---
"@mantaq/viz": patch
"@mantaq/inspect": patch
---

`onNavigate` now says why it was called (`by`: `"path"` for a move along the path, `"walk"` for a step or a payload change).

The Step panel is no longer pinned to the bottom of the window, so it does not cover the canvas when the viewer is only partly on screen.

"Full screen" stays on one line when the path and the line about the walk outside the group show beside it.
