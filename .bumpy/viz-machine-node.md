---
"@mantaq/viz": minor
---

A group node now has an enter control after the row under its name. When the reader clicks enter or presses Enter on it, the viewer draws the group entered: the states of the group, and a stub for each outside state that an arrow of the group reaches or comes from. A stub has a dashed frame. A click on a stub goes back one level and puts focus on the node that draws that state there. The new viewer option `onEnterGroup({ node, name })` receives the group node's id (`@payment`) and the group's name.

The walk goes on inside a group entered. It is the same machine and the same walk. The current state is marked, and a click on an arrow that leaves it sends that arrow's event, also an arrow to a stub. When the walk leaves the group, the stub that is now current is marked, and a line in the bar above the canvas says where the walk is. While the walk is in a state of a folded group, the row under the group name says which one (`now in confirming`), or `ended in sent` at a final state.
