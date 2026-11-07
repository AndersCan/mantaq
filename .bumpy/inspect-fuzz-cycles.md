---
"@mantaq/inspect": patch
---

Fuzzer: the loop operator repeats the whole cycle that changed context (`submit, rejected`), not only its last step, so counters bumped by a round trip are reached. Kept sequences are shrunk until no step can go.
