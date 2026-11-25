---
"@mantaq/viz": patch
"@mantaq/inspect": patch
---

The new `followFocus` option hands the host a follower, `{ follow, mounted }`, that moves the viewer along its path to the host's. `mounted()` turns false once the viewer is gone or drawn again on its root. `onNavigate` now says why it was called (`by`: `"path"`, `"walk"` or `"link"`). A host can use them to keep the path in its own history.

The Step panel is no longer pinned to the bottom of the window, so it does not cover the canvas when the viewer is only partly on screen.

"Full screen" stays on one line when the path and the line about the walk outside the group show beside it.
