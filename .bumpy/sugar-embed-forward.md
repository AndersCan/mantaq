---
"@mantaq/sugar": minor
---

`embed` takes two new options. `forward: [retry, dismiss]` lists parent inputs that embed sends to the running child while the parent is in the state `in`. Each one must be an input of the child. `snapshot: event` names a parent internal event that carries the snapshot of the child, on entry and after each change. The parent handles it in `in`, for example to keep the child snapshot in its context. The `embedded` tag on the effect fn now also has `forward` (the forwarded event types) and `snapshot` (the event type, or undefined).
