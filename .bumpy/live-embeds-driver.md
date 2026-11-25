---
"@mantaq/sugar": minor
"@mantaq/inspect": minor
"@mantaq/viz": minor
---

The live driver reports the machines that the current states embed. `embed` from `@mantaq/sugar` takes a new option `keep`: the context field where the `snapshot` handler of the parent keeps the child snapshot. The `embedded` tag now has `keep` too. In `@mantaq/viz`, `VizLiveState` has the new optional field `embeds`: one entry per running embed with its state, its machine, the forwarded inputs and, when the embed has `keep`, the current state of the child. The driver of `@mantaq/inspect` fills it, and it no longer holds embed effects in held mode, because a held embed builds no child and `forward` reaches nothing. The effects of the child run on the clock of the parent.
