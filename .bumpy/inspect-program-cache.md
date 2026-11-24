---
"@mantaq/inspect": patch
---

The Vite plugin type-checks each machine file once per build or save. The targets module, the previews module and the document share one TypeScript program per file, and the programs share the files they parsed. A save rebuilds only the files it changed, and the dev server inspects the files in parallel. The output does not change.
