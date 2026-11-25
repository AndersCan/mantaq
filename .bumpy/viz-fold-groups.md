---
"@mantaq/viz": minor
---

The viewer draws a machine whose states have a `group` folded: each group is one node with its arrows in and out. The node has the machine-node look. It shows the group name and how many states it holds, and it has no enter control yet. An arrow between two states of one group is drawn as a loop on the group node. Arrows with the same ends, event and kind are one arrow. While the walk is in a state of a group, the group node is marked current, and a click on an arrow that leaves it sends the real edge that leaves the current state. Details of a group arrow lists its real edges with their conditions. Details of a group node lists its states. A machine without groups is drawn as before.
