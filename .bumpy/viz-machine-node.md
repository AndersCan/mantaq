---
"@mantaq/viz": minor
---

The viewer draws a state that embeds another machine (`states[].machine`) as a machine node. The node is one state with its arrows in and out. Under its name it shows a box-in-a-box glyph, the embedded machine's id and an enter control. The viewer does not draw the states of the embedded machine. When the reader clicks enter or presses Enter on it, the new viewer option `onEnter(machine)` receives the id. Without `onEnter`, the node has no enter control.
