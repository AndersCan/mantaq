---
"@mantaq/core": patch
---

`settled()` no longer waits for an effect whose state the actor has left. That effect is aborted on exit and can no longer emit, so a test that injects an effect's answer can await `settled()` even when the real call never answers. Code that awaited `settled()` to see outside work an abandoned effect does after its state was left now resolves before that work.
