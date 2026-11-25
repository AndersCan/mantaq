---
"@mantaq/viz": minor
---

An entered machine runs live. When the walk is in a state that embeds a machine and you enter it, the canvas marks the current state of that machine. A click on one of its arrows sends the event to the root as a normal step, when the root forwards that event to it (the `forward` option of `embed`). Other arrows out of its state carry a lock and say why they send nothing. When the root is not in the embedding state, or the driver does not know the state of the child, the machine is drawn without its state and the Step tab says why. The Step tab hint inside an entered machine now says which arrows send.

`?payload=` entries now name their machine: `machine:event=<json>`. A bare `event=<json>` entry of an old link belongs to the machine in `?machine=`. `?step=` links do not change: a forwarded event is a step to the root.
