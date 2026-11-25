---
"@mantaq/viz": minor
---

The viewer keeps a focus path: the machine it opened on, then the machine of a board that the reader opened, then the group the reader entered. A path of crumbs above the canvas replaces the machine name that led back to the board. A click on a crumb goes back there, and Escape goes back one level. Moves along the path never change the walk or the step log.

The path is in the new viewer option `focus` and in the new `focus` field of `onNavigate`: a machine's name on a board, then a group node's id such as `@payment`. `linkOptions` keeps it in the address bar as `?focus=`, so a shared link opens the same group. With no `machine` option, the viewer opens on the first machine of the document.

The overlap warning is now a line in the bar above the drawing, not a row inside it. Each machine is laid out once, so going back to a machine does not lay it out again.
