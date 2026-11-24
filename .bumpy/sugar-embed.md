---
"@mantaq/sugar": minor
---

`embed(m, { in, machine, done, error })` runs a child machine while the parent is in the state `in`. Embed builds the child with the clock of the parent on entry and disposes it when the parent leaves. A final state of the child sends its `done` event to the parent, and `__error` sends `error`. Child outputs go to the parent. The effect fn carries the child machine as `embedded`, so tools can find it.
