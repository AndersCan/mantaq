---
"@mantaq/viz": minor
"@mantaq/inspect": minor
---

The live driver holds effects: they do not run, and `VizLiveState.waiting` names the ones waiting for an answer. `createDriver(target, { effectMode: "real" })` runs them.

Breaking: createDriver holds effects by default — affects code calling @mantaq/inspect/drive directly (none found in mantaq apps or justus); pass { effectMode: "real" } to keep running them.

Breaking: VizLiveState has required effectMode and waiting — affects custom VizDriver implementations (none known).
