# Changelog

## 0.0.6

<sub>2026-11-07</sub>

- _(patch)_
  READMEs rewritten against the current API (`Actor({...})`, `m.on(state, { event, to, handler })`, `VirtualClock()`, `setTimeout(ms, { cb, signal })`, `on("change", { fn })`); every README `ts` snippet now typechecks in `docs:check`. Core README gains "See your machine" (`@mantaq/inspect` Vite plugin) and the agent-skill install line. Packages declare `homepage`, `repository`, `bugs` and `keywords`.

## 0.0.5

<sub>2026-11-03</sub>

- _(patch)_ `Either.right()` with no argument builds a void right, so ports can return `Either<E, void>`.

## 0.0.4

<sub>2026-09-04</sub>

- _(patch)_
  Export INITIAL_NODE_ID from @mantaq/traversal; buildGraph returns empty graph instead of throwing; drop Date.now timestamps from history; remove dead assertReachedState/assertNeverReachedState aliases from @mantaq/test.
- _(patch)_ Either.from rejects undefined/null as Left (#208).

## 0.0.3

<sub>2026-08-20</sub>

- _(patch)_
  Reduced published bundle size of @mantaq/core by minifying dist output and marking packages side-effect-free for consumer tree-shaking.

## 0.0.2

<sub>2026-08-12</sub>

- _(patch)_
  Added universal terminal error state for contained user errors; send() no longer throws and errors surface via snapshot().error.

## 0.0.1

<sub>2026-08-09</sub>

- _(patch)_
  First 0.0.1 release: actor-model state machine runtime (hierarchical states, events, effects, virtual clock) with sugar helpers, graph traversal/coverage, test harness, seeded property-based testing, and the shared Either utility — all north-star quality gates enforced.
