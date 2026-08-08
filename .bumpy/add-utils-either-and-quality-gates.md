---
"@mantaq/utils": minor
"@mantaq/traversal": patch
"@mantaq/core": patch
---

Added @mantaq/utils Either type; migrated traversal and core error handling to Either — the internal registry returns Either instead of throwing (errors flow, never throw). Added no-throw oxlint gate and wired knip, coverage, and oxlint quality gates.
