---
"@mantaq/inspect": minor
---

Remove the `mantaq-inspect` CLI, its `--json` and static HTML export, the `htmlPage` export and the `./live-embedded` export. For the viz document, call `inspect` and `toVizMachine` from the API. Use the Vite plugin (`@mantaq/inspect/vite`) for the visualizer and `expectNoDesignErrors` in tests to gate on design errors.
