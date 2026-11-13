---
"@mantaq/sugar": minor
---

`pool.resize(count)` changes how many workers a pool runs while it runs. Growing adds free workers that take waiting items at once; shrinking lets running workers finish, then removes them. The inbox takes a new `WORKERS_RESIZED` event.
