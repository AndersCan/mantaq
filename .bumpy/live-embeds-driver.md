---
"@mantaq/sugar": minor
"@mantaq/inspect": minor
"@mantaq/viz": minor
---

The live driver reports the machine that each current state embeds. `embed` from `@mantaq/sugar` takes a new option `keep`: the context field where the `snapshot` handler of the parent keeps the child snapshot. `keep` needs `snapshot`. The `embedded` tag now has `keep` too. Embed also calls `childBuilt` from the effect input with each child that it builds, when a tool puts one there.

In `@mantaq/viz`, `VizLiveState` has the new optional field `embeds`: one entry per embedding state that is current, with the state, the machine, the forwarded inputs and, when the embed has `keep`, the current state of the child.

The driver of `@mantaq/inspect` fills `embeds`. In held mode, an embed that forwards inputs or keeps its child snapshot now builds its child, so a forwarded input reaches it. The effects of that child are held, except its first-state effects, which core runs while it builds the child. Other embeds stay held, as before.
