---
"@mantaq/viz": minor
---

The payload form is a sheet pinned to the bottom of the viewer: Send is always on screen. The popover on the diagram is gone, along with its `.payload-popover` CSS class and its placement; the sheet uses `.payload-sheet`, and the event's edge gets `data-composing`. Styles that targeted `.payload-popover` need to move to `.payload-sheet`.
