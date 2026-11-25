---
"@mantaq/viz": patch
---

Escape in a text field outside the viewer, such as the search box of a docs site, no longer moves the viewer back one level. Without a panel, Escape first clears the line under the diagram, and the `?` of a blocked arrow no longer draws that arrow like the arrow just sent. A line that appears above the canvas no longer makes the browser scroll the page. After a step, the canvas scrolls to the labels of the arrows that leave the state it shows, and of the `onAny` node, not to the arrows of another current state.
