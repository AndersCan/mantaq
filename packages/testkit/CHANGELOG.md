# Changelog

## 2.1.0

<sub>2026-11-10</sub>

- _(minor)_
  Add `assertMatchesModel`: run seeded random walks on a model machine and an app without mantaq, and fail on the first state that differs.

## 2.0.8

<sub>2026-11-08</sub>

- _(patch)_ Updated dependency `@mantaq/core` v0.7.1

## 2.0.7

<sub>2026-11-07</sub>

- _(patch)_ Updated dependency `@mantaq/core` v0.7.0

## 2.0.6

<sub>2026-11-07</sub>

- _(patch)_
  READMEs rewritten against the current API (`Actor({...})`, `m.on(state, { event, to, handler })`, `VirtualClock()`, `setTimeout(ms, { cb, signal })`, `on("change", { fn })`); every README `ts` snippet now typechecks in `docs:check`. Core README gains "See your machine" (`@mantaq/inspect` Vite plugin) and the agent-skill install line. Packages declare `homepage`, `repository`, `bugs` and `keywords`.

## 2.0.5

<sub>2026-11-06</sub>

- _(patch)_ Updated dependency `@mantaq/core` v0.6.0

## 2.0.4

<sub>2026-11-05</sub>

- _(patch)_ Updated dependency `@mantaq/core` v0.5.4

## 2.0.3

<sub>2026-11-03</sub>

- _(patch)_ Updated dependency `@mantaq/core` v0.5.3

## 2.0.2

<sub>2026-11-03</sub>

- _(patch)_ Updated dependency `@mantaq/core` v0.5.2

## 2.0.1

<sub>2026-11-02</sub>

- _(patch)_ Updated dependency `@mantaq/core` v0.5.1

## 2.0.0

<sub>2026-11-01</sub>

- _(major)_
  **Breaking.** `harness.graph` (the traversal `ActorGraph`) now has a `*`
  any-node and one edge per declared target, which changes coverage totals.
  `onAny` transitions are also counted correctly in coverage (#309).
- _(patch)_
  `computeCoverage` no longer counts the `onAny` pseudo-state as an unvisitable
  state, and counts an `onAny` transition as covered once its event fired from
  any state. `assertAllStatesVisited` and `assertAllTransitionsVisited` can now
  pass for machines that use `onAny`.

## 1.0.0

<sub>2026-09-04</sub>

- _(major)_
  Export INITIAL_NODE_ID from @mantaq/traversal; buildGraph returns empty graph instead of throwing; drop Date.now timestamps from history; remove dead assertReachedState/assertNeverReachedState aliases from @mantaq/test.
- _(minor)_
  Named effects: `m.effect(stateRef, { name, fn })` — the name is required and identifies
  the effect in tests and history. Effects are now recorded when they actually run:
  `TransitionInfo` carries `effects: string[]`, and `@mantaq/traversal` history effect
  records are `{ stateName, effectName }` instead of being inferred from registration.
  Test harness assertions take both names: `assertEffectRan(stateName, effectName)`,
  `assertEffectNeverRan(stateName, effectName)`, `wasEffectRun(stateName, effectName)`.
  Breaking: all `m.effect(stateRef, fn)` call sites must pass `{ name, fn }`.
- _(patch)_ Harness observes region child states and transitions (#199).

## 0.1.2

<sub>2026-08-20</sub>

- _(patch)_ Updated dependency `@mantaq/core` v0.3.0

## 0.1.1

<sub>2026-08-13</sub>

- _(patch)_
  Added actor recovery, transition observability, snapshot state payloads, and hardened clocks against invalid ms; fixed error-report accuracy and made the test harness context-generic. Banned console.* in library src — failures now throw (misconfiguration) or route to the error state (runtime), with platform-matching clock delay clamping.

## 0.1.0

<sub>2026-08-12</sub>

- _(minor)_
  Breaking: events are now envelopes { type, payload } instead of flat { id, ...payload }. EventRef.id renamed to .type. Payload id can no longer be clobbered by the event type. All payload reads move to event.payload.*
- _(patch)_ sync dependents to core 0.0.3
- _(patch)_ Fixed exports in committed package.json pointing at missing dist; vp pack rewrites them at publish time

## 0.0.2

<sub>2026-08-09</sub>

- _(patch)_
  Context in handlers and effects is now a handle (`context.get()` / `context.set()`), and `set()` replaces the whole context — so context writes emit a `change` event even without a transition. Snapshots now carry `context`, and change handlers receive the previous snapshot (`(snapshot, prev)`) for identity comparison.

## 0.0.1

<sub>2026-08-09</sub>

- _(patch)_
  First 0.0.1 release: actor-model state machine runtime (hierarchical states, events, effects, virtual clock) with sugar helpers, graph traversal/coverage, test harness, seeded property-based testing, and the shared Either utility — all north-star quality gates enforced.
