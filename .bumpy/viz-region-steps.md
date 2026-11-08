---
"@mantaq/viz": minor
"@mantaq/inspect": minor
---

A step can name the region it goes to (`actor: { region }`), in the live driver, the fuzzer, saved journeys and shared links (`upload>photoPicked`). Each region's start state is marked `initial`, and `VizLiveState.regions` lists where every region is.

Breaking: document format v14 — affects anyone serving a prebuilt viz.json; rebuild it.

Breaking: VizLiveState has a required regions and VizLiveOutcome gains "missing" — affects custom VizDriver implementations and exhaustive switches on the outcome (none known).
