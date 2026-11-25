---
"@mantaq/viz": minor
---

The viewer shows a state or an arrow as clickable only when a click on it does something. An arrow is a button (pointer, tab stop, `role="button"`) only while a click sends its event and the walk moves. All other arrows are plain: without a driver, from another state, at a final state, sent by another part, in a map with no child, and blocked by a guard. A click on a plain arrow does nothing. Its hover title and its `?` Details say why it cannot be sent. A blocked arrow keeps its lock, and its Details still offer Send. A state is a button only when the Details panel is shown. The current crumb of the path above the canvas is plain text.
