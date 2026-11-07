---
"@mantaq/viz": minor
"@mantaq/inspect": minor
---

Breaking: viz documents are version 13. `VizFuzz.expectations` lists every rule the machine file writes (`neverSee` and `mustSee`) with `held`, whether fuzzing kept it; `failedExpectations` still lists the ones that broke. Stored viz.json files must be exported again; documents from mantaq docs and the Vite plugin regenerate at build.
