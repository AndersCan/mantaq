---
"@mantaq/viz": patch
"@mantaq/inspect": patch
---

On a page that keeps the walk in the address bar (`linkOptions`), a move along the path adds a history entry: entering a group or a machine of a board, a crumb click, Escape, and a click on a dashed stub box. The browser's Back and Forward then move along the path, and a reload opens the same place. A step of the walk or a payload change replaces the current entry, so a walk does not fill the history. Back and Forward never change the walk. The new `followFocus` option of the viewer takes the path from the host.

The Step panel is no longer pinned to the bottom of the window, so it does not cover the canvas when the viewer is only partly on screen. Each canvas is at most `75dvh - 5rem` high, so the canvas and the panel fit in one window.

"Full screen" stays on one line when the path and the line about the walk outside the group show beside it.
