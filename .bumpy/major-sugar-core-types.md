---
"@mantaq/sugar": major
---

**Breaking.** Sugar wraps core's `ActorBuilder`, so its builder `on()` now takes
`{ event, to }` instead of `eventRef` (from the core builder-targets change,
#297). Migrate with `node packages/codemod/src/cli.ts <tsconfig.json>...`
(`@mantaq/codemod`), then `vp check`.
