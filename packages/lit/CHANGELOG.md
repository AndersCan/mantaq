# Changelog

## 0.1.1

<sub>2026-11-07</sub>

- _(patch)_
  READMEs rewritten against the current API (`Actor({...})`, `m.on(state, { event, to, handler })`, `VirtualClock()`, `setTimeout(ms, { cb, signal })`, `on("change", { fn })`); every README `ts` snippet now typechecks in `docs:check`. Core README gains "See your machine" (`@mantaq/inspect` Vite plugin) and the agent-skill install line. Packages declare `homepage`, `repository`, `bugs` and `keywords`.

## 0.1.0

<sub>2026-11-06</sub>

- _(minor)_ New experimental package: `watch(actor, select)` binds a lit-html part to an actor.
