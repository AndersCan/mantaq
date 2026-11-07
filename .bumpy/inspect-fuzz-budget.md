---
"@mantaq/inspect": minor
---

Fuzz budget as time: `fuzz: { timeLimitMs }` stops at full coverage, the iteration cap, or the time limit, still seeded. `iterations` is now a cap: fuzzing stops early once every state and edge is covered, and `fuzz.iterations` in viz.json reports how many ran. The Vite dev default is `{ timeLimitMs: 2000 }` (was 500 iterations); `vite build` now defaults to 2000 iterations like `inspect` and Astro. Warns which states and edges fuzz never reached, with the iterations run and why it stopped, and when `inspect` without `source` sends events without payloads. A user timer callback that throws under `clock.advance` is now a fuzz error (event `advance`) with its replay path, instead of aborting `inspect`.
