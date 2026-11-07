---
"@mantaq/core": patch
"@mantaq/sugar": patch
"@mantaq/test": patch
"@mantaq/traversal": patch
"@mantaq/inspect": patch
"@mantaq/viz": patch
"@mantaq/lit": patch
"@mantaq/pbt": patch
"@mantaq/utils": patch
---

READMEs rewritten against the current API (`Actor({...})`, `m.on(state, { event, to, handler })`, `VirtualClock()`, `setTimeout(ms, { cb, signal })`, `on("change", { fn })`); every README `ts` snippet now typechecks in `docs:check`. Core README gains "See your machine" (`@mantaq/inspect` Vite plugin) and the agent-skill install line. Packages declare `homepage`, `repository`, `bugs` and `keywords`.
