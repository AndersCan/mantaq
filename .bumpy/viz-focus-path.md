---
"@mantaq/viz": minor
---

The viewer keeps a focus path: the machine it opened on, then each machine the reader opened. Enter on a machine node draws the embedded machine from the same document, without the walk. A box on a board opens that machine as before. A path of crumbs above the canvas replaces the machine name that led back to the board. A click on a crumb goes back to that machine, and Escape goes back one. Entering and leaving never change the walk or the step log.

The path is in the new viewer option `focus` and in the new `focus` field of `onNavigate`. `linkOptions` keeps it in the address bar as `?focus=`, so a shared link opens the same machine. `onEnter` now gets `{ machine, state }`: the embedded machine and the state entered from. The enter control is drawn without `onEnter` too. With no `machine` option, the viewer opens on the first machine that no other machine embeds.

The overlap warning is now a line in the bar above the drawing, not a row inside it. Each machine is laid out once, so going back to a machine does not lay it out again.
