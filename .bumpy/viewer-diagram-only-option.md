---
"@mantaq/viz": minor
"@mantaq/inspect": minor
---

`ViewerOptions.diagramOnly` opens the viewer with only the diagram and a "Show controls" button. `<Machine diagramOnly />` (and `mountDriven({ diagramOnly: true })`) pass it on. The docs' getting-started steps, the home page, States (side by side) and the app-without-mantaq guide open this way, and step 1 no longer asks readers to ignore the tabs.

The fuzzer reads payload samples from each exported actor's type (`inputs`, `internal`, `outputs`), not only from handlers in the machine's own file. A machine built in another package, such as `createPool`'s inbox and workers, no longer gets events with no payload, so the docs' team inbox shows no false "team.ITEMS_RETURNED in holding throws" finding.
