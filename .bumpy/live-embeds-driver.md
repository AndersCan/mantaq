---
"@mantaq/sugar": minor
"@mantaq/inspect": minor
"@mantaq/viz": minor
---

The live driver reports where each embedded machine is.

`embed` from `@mantaq/sugar` takes a new option `keep`: the context field where the `snapshot` handler of the parent keeps the child snapshot. `keep` needs `snapshot`. The `embedded` tag now has `keep` and `running()`, which returns the child that runs now. Embed also calls `childBuilt` from the effect input with each child that it builds, when a tool puts one there.

In `@mantaq/viz`, a state that embeds a machine can list `forward`: the inputs that embed sends on to that machine. `VizLiveState` has the new optional field `embeds`: one entry per current state that embeds a machine, with the current state of the child when the embed has `keep`.

The driver of `@mantaq/inspect` fills both. In held mode, an embed that forwards inputs or keeps its child snapshot now builds its child, so a forwarded input reaches it. The driver holds the effects of that child, also when the first state of the machine built it. The first-state effects of the child still run, on each entry and in each dry-run copy, as for the machine itself. Other embeds stay held, as before.
