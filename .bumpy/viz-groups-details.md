---
"@mantaq/viz": patch
---

Details and the accessible names of arrows and shared nodes name each state as the canvas draws it: a group node as `group payment`, not `@payment`, and a state in a region by its own name, `paid`, not `order.paid`, unless another state of the machine has that name. A move between two states of the group is listed once, under "inside". A state picked in Details of a group node shows the selection ring on its group node. A click on a stub selects that state and opens its Details. Inside an entered group, an arrow whose other branch goes to a state outside the view shows its own condition, not "else".
