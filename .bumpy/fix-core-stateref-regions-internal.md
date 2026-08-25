---
"@mantaq/core": patch
---

Mark `StateRef.regions()` as `@internal` and drop it from the public API docs
(#241). It stores region config on `_regions` but the runtime never reads it, so
calling it is a silent no-op; the method stays callable (non-breaking) but is no
longer advertised as working in `API.md` or the `core.mdx` reference table.
