---
"@mantaq/inspect": minor
---

Remove the `mantaq-inspect` CLI, its `--json` and static HTML export, and the `htmlPage` export. Use the Vite plugin (`@mantaq/inspect/vite`) for the visualizer and `expectNoDesignErrors` in tests to gate on design errors.
