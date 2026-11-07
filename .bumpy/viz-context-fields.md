---
"@mantaq/viz": minor
"@mantaq/inspect": minor
---

Breaking: viz documents are version 12. `VizEvent.payloadType` is replaced by `payload` (the fields of the event's payload type, read from the types and their JSDoc), and `VizMachine.context` lists the fields of the actor's context type. Stored viz.json files must be exported again; documents from mantaq docs and the Vite plugin regenerate at build.
