---
"@mantaq/inspect": minor
---

Fuzzing takes sample payloads from the types of the events a machine accepts (the actor's `send` type and the `events` a factory returns), so a machine built by a helper such as `createPool` gets typed payloads and no false findings. `MachineExport` gains `samples`.
