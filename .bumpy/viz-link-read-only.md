---
"@mantaq/viz": minor
"@mantaq/inspect": minor
---

The viewer no longer writes the walk to the address bar. `linkOptions` reads the link (`?machine=`, `?run=`, `?step=`, `?payload=`, `?value=`, `?focus=`) and opens what it names, but a step, a payload change, a move along the path and the machine picker leave the address as it is. A reload opens the page as its link says, so a plain link opens the walk at its start. The browser's Back and Forward no longer move along the path: the path's crumbs and Escape do. The live page of the Vite plugin keeps the walk in memory, so a redraw after a save still replays it on the new code.
