---
"@mantaq/traversal": minor
---

`coveringWalks(graph)` plans event walks from the initial state that together take every sendable edge at least once, and lists the edges no walk can reach. Events the machine raises itself are followed as `sender: "machine"` steps. `sendableEdges(graph)` returns the edges an outside sender can take.
