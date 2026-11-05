---
"@mantaq/inspect": minor
---

`tests` takes named runs (`{ name, steps }[]`) instead of bare step lists, and they show up as `machine.runs`. `inspectModule` reads recorded runs from `__runs__/*.json` next to the machine file, drops internal events a replay already produces, and drops runs that replay to a different end state with a warning. Breaking: wrap each step list in `{ name, steps }`.
