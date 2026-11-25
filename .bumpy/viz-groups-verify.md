---
"@mantaq/viz": patch
---

Escape in a text field outside the viewer, such as the search box of a docs site, no longer moves the viewer back one level. Without a panel, Escape first clears the line under the diagram, and the `?` of a blocked arrow no longer draws that arrow like the arrow just sent. A line that appears above the canvas no longer makes the browser scroll the page. After a step, the canvas scrolls to the labels of the arrows that leave the state it shows, not to the arrows of another current state.

`followFocus` now receives a follower, `{ follow, mounted }`, in place of a bare function. `linkOptions` keeps one `popstate` listener for all its viewers and drops a viewer that is no longer mounted, so a page that mounts its viewer again no longer adds a listener each time.
