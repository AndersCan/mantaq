---
"@mantaq/viz": patch
"@mantaq/inspect": patch
---

On a page that keeps the walk in the address bar (`linkOptions`), a move along the path adds a history entry: entering a group or a machine of a board, a crumb click, Escape, and a click on a dashed stub box. The browser's Back and Forward then move along the path, and a reload opens the same place. A step of the walk or a payload change replaces the current entry, so a walk does not fill the history. Back and Forward never change the walk. The new `followFocus` option hands the host a follower, `{ follow, mounted }`, that moves the viewer along its path to the host's; `mounted()` turns false once the viewer is gone or drawn again on its root, and `onNavigate` now says why it was called (`by`: `"path"`, `"walk"` or `"link"`). The address keeps its `#hash`.

The Step panel is no longer pinned to the bottom of the window, so it does not cover the canvas when the viewer is only partly on screen.

"Full screen" stays on one line when the path and the line about the walk outside the group show beside it.
